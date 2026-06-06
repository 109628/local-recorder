/**
 * recorder-client.ts — browser-only recording engine.
 * SSR-safe: all window/IndexedDB access is guarded by typeof window checks.
 *
 * Responsibilities:
 *  1. Open getUserMedia (audio+video, echo/noise cancellation on, 720p cap)
 *  2. On recordStart(recordStartAt): schedule MediaRecorder to begin at the
 *     exact wall-clock ms so all participants are time-aligned.
 *  3. Buffer every dataavailable Blob into IndexedDB and upload directly to
 *     GCS using a short-lived signed PUT URL from /api/storage/upload-url.
 *     On upload failure: retry with exponential backoff.
 *  4. connectEvents(): open SSE and dispatch parsed ServerEvents to caller.
 *  5. stop(): halt MediaRecorder, stop all tracks (camera light off), flush uploads.
 *
 * mimeType fallback chain (first supported wins):
 *   1. video/webm;codecs=vp8,opus  (VP8 + Opus — widest browser support)
 *   2. video/webm;codecs=vp9,opus  (VP9 + Opus — better quality, Chrome/FF)
 *   3. video/webm                  (browser-chosen codec)
 */

import type { ChunkMeta, ServerEvent } from "./types";

// ---------------------------------------------------------------------------
// IndexedDB helpers (SSR-safe)
// ---------------------------------------------------------------------------

const DB_NAME = "localrecorde";
const STORE_NAME = "chunks";
const DB_VERSION = 1;

interface StoredChunk {
  key: string; // sessionId/participantId/chunkIndex
  meta: ChunkMeta;
  blob: Blob;
  uploadedAt: number | null;
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: "key" });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function storeChunk(db: IDBDatabase, record: StoredChunk): Promise<void> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    const store = tx.objectStore(STORE_NAME);
    const req = store.put(record);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

async function markUploaded(db: IDBDatabase, key: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    const store = tx.objectStore(STORE_NAME);
    const getReq = store.get(key);
    getReq.onsuccess = () => {
      const record = getReq.result as StoredChunk | undefined;
      if (!record) { resolve(); return; }
      record.uploadedAt = Date.now();
      const putReq = store.put(record);
      putReq.onsuccess = () => resolve();
      putReq.onerror = () => reject(putReq.error);
    };
    getReq.onerror = () => reject(getReq.error);
  });
}

// ---------------------------------------------------------------------------
// Upload with exponential backoff
// ---------------------------------------------------------------------------

const MAX_RETRIES = 6;
const BASE_DELAY_MS = 1_000;

async function uploadWithRetry(
  blob: Blob,
  meta: ChunkMeta,
  authToken: string,
  db: IDBDatabase,
  key: string,
  onError?: (message: string) => void
): Promise<boolean> {
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      // Primary path: same-origin proxy upload avoids browser<->GCS CORS issues.
      const q = new URLSearchParams({
        sessionId: meta.sessionId,
        participantId: meta.participantId,
        chunkIndex: String(meta.chunkIndex),
        recordStartAt: String(meta.recordStartAt),
      });
      const proxyRes = await fetch(`/api/storage/upload-proxy?${q.toString()}`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${authToken}`,
          "Content-Type": meta.mimeType,
        },
        body: blob,
      });
      if (proxyRes.ok) {
        await markUploaded(db, key);
        return true;
      }
      const proxyBody = await proxyRes.text().catch(() => "");
      throw new Error(
        `Upload proxy HTTP ${proxyRes.status}${proxyBody ? `: ${proxyBody}` : ""}`
      );
    } catch (err) {

      if (attempt === MAX_RETRIES) {
        // Give up — chunk stays in IndexedDB for manual recovery
        console.error(`[recorder] Upload failed permanently for chunk ${key}`, err);
        onError?.(
          "Chunk upload failed after retries. Check GCS credentials/CORS and rejoin if session expired."
        );
        return false;
      }
      const delay = BASE_DELAY_MS * 2 ** attempt + Math.random() * 500;
      await new Promise((r) => setTimeout(r, delay));
    }
  }
  return false;
}

// ---------------------------------------------------------------------------
// Public interface
// ---------------------------------------------------------------------------

export interface RecorderEvents {
  onStateChange: (state: "idle" | "mic-ready" | "recording" | "stopped") => void;
  onLevelUpdate: (level: number) => void; // 0–1 RMS amplitude
  onError: (message: string) => void;
  onChunkUploaded: (chunkIndex: number) => void;
  /** Called once the MediaStream is live — use to attach srcObject to a <video> */
  onStream?: (stream: MediaStream) => void;
}

// mimeType fallback chain — first supported by the browser wins
const MIME_CANDIDATES = [
  "video/webm;codecs=vp8,opus",
  "video/webm;codecs=vp9,opus",
  "video/webm",
] as const;

function selectMimeType(): string | null {
  for (const mime of MIME_CANDIDATES) {
    if (MediaRecorder.isTypeSupported(mime)) return mime;
  }
  return null;
}

export class RecorderClient {
  private stream: MediaStream | null = null;
  private mediaRecorder: MediaRecorder | null = null;
  private db: IDBDatabase | null = null;
  private analyser: AnalyserNode | null = null;
  private audioCtx: AudioContext | null = null;
  private monitorGain: GainNode | null = null;
  private levelRafId: number | null = null;
  private eventSource: EventSource | null = null;

  private sessionId = "";
  private participantId = "";
  private recordStartAt = 0;
  private chunkIndex = 0;
  private scheduledStartTimeout: ReturnType<typeof setTimeout> | null = null;
  private authToken = "";

  private readonly callbacks: RecorderEvents;

  constructor(callbacks: RecorderEvents) {
    this.callbacks = callbacks;
  }

  setAuthToken(token: string): void {
    this.authToken = token;
  }

  /** Must be called before anything else. Opens camera+mic + IndexedDB. */
  async init(): Promise<void> {
    if (typeof window === "undefined") return;

    // Open IndexedDB
    this.db = await openDb();

    // Request camera + microphone (720p cap via ideal constraints)
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          sampleRate: 48_000,
        },
        video: {
          width: { ideal: 1280 },
          height: { ideal: 720 },
          frameRate: { ideal: 30 },
        },
      });
    } catch (err) {
      const isDenied =
        err instanceof DOMException &&
        (err.name === "NotAllowedError" || err.name === "PermissionDeniedError");
      const msg = isDenied
        ? "Camera and microphone access denied. Please allow both permissions and reload."
        : "Could not open camera or microphone. Check your device and browser settings.";
      this.callbacks.onError(msg);
      return;
    }

    // Notify the UI so it can attach the stream to a <video> preview
    this.callbacks.onStream?.(this.stream);

    // Set up Web Audio analyser for level metering (audio track only)
    this.audioCtx = new AudioContext();
    const src = this.audioCtx.createMediaStreamSource(this.stream);
    this.analyser = this.audioCtx.createAnalyser();
    this.analyser.fftSize = 256;
    src.connect(this.analyser);
    // Keep local monitor muted by default; user can opt in from UI.
    this.monitorGain = this.audioCtx.createGain();
    this.monitorGain.gain.value = 0;
    src.connect(this.monitorGain);
    this.monitorGain.connect(this.audioCtx.destination);
    this.startLevelLoop();

    this.callbacks.onStateChange("mic-ready");
  }

  /** Returns the live MediaStream if already initialised, otherwise null. */
  getStream(): MediaStream | null {
    return this.stream;
  }

  /**
   * Optional local monitoring so users can hear their own mic during solo tests.
   * Defaults to off to avoid accidental feedback loops.
   */
  setMonitorEnabled(enabled: boolean, gain = 0.18): void {
    if (!this.audioCtx || !this.monitorGain) return;
    if (enabled && this.audioCtx.state !== "running") {
      void this.audioCtx.resume();
    }
    const target = enabled ? Math.max(0, Math.min(gain, 1)) : 0;
    this.monitorGain.gain.setTargetAtTime(
      target,
      this.audioCtx.currentTime,
      0.03
    );
  }

  // ---------------------------------------------------------------------------
  // SSE events
  // ---------------------------------------------------------------------------

  /**
   * Opens EventSource and calls onEvent for each parsed ServerEvent.
   * Automatically handles reconnection (browser-native SSE retry).
   */
  connectEvents(
    sessionId: string,
    participantId: string,
    onEvent: (evt: ServerEvent) => void
  ): void {
    if (typeof window === "undefined") return;
    this.sessionId = sessionId;
    this.participantId = participantId;

    const url = `/api/session/${sessionId}/events?pid=${participantId}`;
    this.eventSource = new EventSource(url);

    this.eventSource.onmessage = (e) => {
      try {
        const data = JSON.parse(e.data) as ServerEvent;
        onEvent(data);
      } catch {
        // Malformed frame — ignore
      }
    };

    this.eventSource.onerror = () => {
      // SSE will auto-reconnect; nothing to do here
    };
  }

  // ---------------------------------------------------------------------------
  // Recording lifecycle
  // ---------------------------------------------------------------------------

  /**
   * Schedule recording to begin at the supplied wall-clock ms.
   * If the timestamp is already in the past (clock skew), starts immediately.
   */
  scheduleRecordStart(recordStartAt: number): void {
    this.recordStartAt = recordStartAt;
    const delay = Math.max(0, recordStartAt - Date.now());

    this.scheduledStartTimeout = setTimeout(() => {
      this.startMediaRecorder();
    }, delay);
  }

  private startMediaRecorder(): void {
    if (!this.stream) {
      this.callbacks.onError("Camera/microphone not initialised.");
      return;
    }

    const mimeType = selectMimeType();
    if (!mimeType) {
      this.callbacks.onError(
        "Browser does not support any required video/webm format. " +
          "Try Chrome 90+ or Firefox 90+."
      );
      return;
    }

    this.chunkIndex = 0;
    this.mediaRecorder = new MediaRecorder(this.stream, {
      mimeType,
      videoBitsPerSecond: 2_500_000,
      audioBitsPerSecond: 128_000,
    });

    this.mediaRecorder.ondataavailable = (e) => {
      if (e.data.size === 0) return;
      void this.handleChunk(e.data);
    };

    this.mediaRecorder.onerror = () => {
      this.callbacks.onError("MediaRecorder encountered an error.");
    };

    // timeslice = 5 000 ms — server gets aligned 5s segments
    this.mediaRecorder.start(5_000);
    this.callbacks.onStateChange("recording");
  }

  private async handleChunk(blob: Blob): Promise<void> {
    const index = this.chunkIndex++;
    // blob.type reflects the actual mimeType negotiated by the browser (e.g. "video/webm")
    const mimeType = blob.type || (this.mediaRecorder?.mimeType ?? "video/webm");
    const meta: ChunkMeta = {
      sessionId: this.sessionId,
      participantId: this.participantId,
      chunkIndex: index,
      recordStartAt: this.recordStartAt,
      mimeType,
    };
    const key = `${this.sessionId}/${this.participantId}/${index}`;

    if (!this.db || !this.authToken) return;

    // Buffer to IndexedDB first — so we never lose a chunk if upload fails
    await storeChunk(this.db, { key, meta, blob, uploadedAt: null });

    // Fire-and-forget upload (retries internally)
    void uploadWithRetry(blob, meta, this.authToken, this.db, key, this.callbacks.onError).then((ok) => {
      if (ok) this.callbacks.onChunkUploaded(index);
    });
  }

  /** Stop recording and turn off camera/mic hardware (camera light goes dark). */
  async stop(): Promise<void> {
    if (this.scheduledStartTimeout) {
      clearTimeout(this.scheduledStartTimeout);
      this.scheduledStartTimeout = null;
    }

    if (
      this.mediaRecorder &&
      this.mediaRecorder.state !== "inactive"
    ) {
      // Request a final dataavailable event before stopping
      this.mediaRecorder.stop();
    }

    // Stop every track so the OS releases camera + mic hardware immediately
    if (this.stream) {
      this.stream.getTracks().forEach((t) => t.stop());
    }

    this.callbacks.onStateChange("stopped");
  }

  /** Release all resources — call on component unmount. */
  destroy(): void {
    if (this.levelRafId !== null) cancelAnimationFrame(this.levelRafId);
    if (this.eventSource) this.eventSource.close();
    // Stop all tracks to release camera and microphone hardware
    if (this.stream) this.stream.getTracks().forEach((t) => t.stop());
    if (this.audioCtx) void this.audioCtx.close();
    this.mediaRecorder = null;
    this.stream = null;
    this.eventSource = null;
  }

  // ---------------------------------------------------------------------------
  // Audio level metering
  // ---------------------------------------------------------------------------

  private startLevelLoop(): void {
    if (!this.analyser) return;
    const buffer = new Uint8Array(this.analyser.frequencyBinCount);

    const tick = () => {
      this.analyser!.getByteTimeDomainData(buffer);
      // RMS over the frame
      let sumSq = 0;
      for (const v of buffer) {
        const normalised = (v - 128) / 128;
        sumSq += normalised * normalised;
      }
      const rms = Math.sqrt(sumSq / buffer.length);
      this.callbacks.onLevelUpdate(Math.min(1, rms * 4)); // scale for UI
      this.levelRafId = requestAnimationFrame(tick);
    };

    this.levelRafId = requestAnimationFrame(tick);
  }
}
