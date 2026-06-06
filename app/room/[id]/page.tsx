"use client";

/**
 * Room page — /room/[id]
 *
 * Credential resolution order:
 *  1. sessionStorage (set by home page after create/join)
 *  2. If absent (cold link open): show inline join form → POST join → store creds
 *
 * After credentials are resolved:
 *  - Opens microphone via RecorderClient.init()
 *  - Connects SSE via RecorderClient.connectEvents()
 *  - Host only: POSTs /api/session/[id]/start|stop and relays recordStartAt
 *    to RecorderClient.scheduleRecordStart()
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { useParams } from "next/navigation";
import type { Participant, JoinSessionResponse, ServerEvent } from "@/lib/types";
import { RecorderClient } from "@/lib/recorder-client";
import type { RecorderEvents } from "@/lib/recorder-client";
import RecorderPanel from "@/components/RecorderPanel";
import { SS_TOKEN, SS_PARTICIPANT_ID, SS_HOST_ID, SS_ROLE } from "@/lib/session-keys";
import { mixSessionInBrowser } from "@/lib/browser-mix";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface Credentials {
  token: string;
  participantId: string;
  hostId: string;
  role: "host" | "guest";
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const pageStyle: React.CSSProperties = {
  minHeight: "100vh",
  display: "flex",
  flexDirection: "column",
  alignItems: "center",
  padding: "40px 24px",
  gap: 24,
};

const headerStyle: React.CSSProperties = {
  width: "100%",
  maxWidth: 480,
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: 12,
};

const codeBoxStyle: React.CSSProperties = {
  background: "var(--panel)",
  borderRadius: 8,
  padding: "6px 14px",
  display: "flex",
  alignItems: "center",
  gap: 10,
};

const codeTextStyle: React.CSSProperties = {
  fontFamily: "monospace",
  fontSize: 14,
  color: "var(--fg)",
  letterSpacing: "0.06em",
  userSelect: "all",
};

const copyBtnStyle: React.CSSProperties = {
  background: "transparent",
  color: "var(--accent)",
  fontSize: 12,
  padding: "4px 8px",
  border: "1px solid var(--accent)",
  borderRadius: 6,
  cursor: "pointer",
};

const errorStyle: React.CSSProperties = {
  fontSize: 13,
  color: "var(--danger)",
  background: "#2d1a1e",
  border: "1px solid var(--danger)",
  borderRadius: 8,
  padding: "8px 12px",
  width: "100%",
  maxWidth: 480,
};

const cardStyle: React.CSSProperties = {
  background: "var(--panel)",
  borderRadius: 16,
  padding: "32px 28px",
  width: "100%",
  maxWidth: 400,
  display: "flex",
  flexDirection: "column",
  gap: 16,
};

// ---------------------------------------------------------------------------
// Inline join form (cold-link entry)
// ---------------------------------------------------------------------------

function InlineJoinForm({
  sessionId,
  onJoined,
}: {
  sessionId: string;
  onJoined: (creds: Credentials) => void;
}) {
  const [name, setName] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) return;

    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/session/${sessionId}/join`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: trimmed }),
      });
      if (!res.ok) {
        const text = await res.text();
        throw new Error(text || `Server error ${res.status}`);
      }
      const data = (await res.json()) as JoinSessionResponse;

      const creds: Credentials = {
        token: data.token,
        participantId: data.participantId,
        hostId: data.session.hostId,
        role: "guest",
      };

      // Persist for potential page refresh
      sessionStorage.setItem(SS_TOKEN, data.token);
      sessionStorage.setItem(SS_PARTICIPANT_ID, data.participantId);
      sessionStorage.setItem(SS_HOST_ID, data.session.hostId);
      sessionStorage.setItem(SS_ROLE, "guest");

      onJoined(creds);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to join. Check the room code."
      );
    } finally {
      setLoading(false);
    }
  }

  return (
    <main style={pageStyle}>
      <div style={cardStyle}>
        <h2
          style={{
            margin: 0,
            fontSize: 20,
            fontWeight: 700,
            color: "var(--fg)",
          }}
        >
          Join session
        </h2>
        <p style={{ margin: 0, fontSize: 13, color: "var(--muted)" }}>
          Room: <span style={{ fontFamily: "monospace" }}>{sessionId}</span>
        </p>
        {error && <p style={errorStyle}>{error}</p>}
        <form
          onSubmit={handleSubmit}
          style={{ display: "flex", flexDirection: "column", gap: 10 }}
        >
          <input
            type="text"
            placeholder="Your name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            maxLength={48}
            autoFocus
            style={{ width: "100%" }}
            aria-label="Your display name"
          />
          <button
            type="submit"
            disabled={loading || !name.trim()}
            style={{
              background: "var(--accent)",
              color: "#fff",
              opacity: loading || !name.trim() ? 0.5 : 1,
              cursor: loading || !name.trim() ? "not-allowed" : "pointer",
            }}
          >
            {loading ? "Joining…" : "Join"}
          </button>
        </form>
      </div>
    </main>
  );
}

// ---------------------------------------------------------------------------
// Main room
// ---------------------------------------------------------------------------

export default function RoomPage() {
  const params = useParams();
  const sessionId = typeof params.id === "string" ? params.id : (params.id?.[0] ?? "");

  // Credentials — resolved from sessionStorage or inline join form
  const [creds, setCreds] = useState<Credentials | null>(null);
  const [credsLoading, setCredsLoading] = useState(true);

  // RecorderClient ref — created once, destroyed on unmount
  const recorderRef = useRef<RecorderClient | null>(null);

  // UI state driven by RecorderClient callbacks
  const [recState, setRecState] =
    useState<"idle" | "mic-ready" | "recording" | "stopped">("idle");
  const [micLevel, setMicLevel] = useState(0);
  const [micError, setMicError] = useState<string | null>(null);
  const [chunksUploaded, setChunksUploaded] = useState(0);

  // Live MediaStream from RecorderClient — null until init() resolves
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [monitorEnabled, setMonitorEnabled] = useState(false);

  // SSE-driven state
  const [participants, setParticipants] = useState<Participant[]>([]);

  // Elapsed timer
  const [elapsedSec, setElapsedSec] = useState(0);
  const elapsedRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Copy-link feedback
  const [copied, setCopied] = useState(false);

  // API errors (start/stop calls)
  const [apiError, setApiError] = useState<string | null>(null);

  // Host-only: browser mix + download state
  const [mixing, setMixing] = useState(false);
  const [mixError, setMixError] = useState<string | null>(null);
  const [mixBlobUrl, setMixBlobUrl] = useState<string | null>(null);

  function clearStoredCredsAndFallback(message: string): void {
    if (typeof window !== "undefined") {
      sessionStorage.removeItem(SS_TOKEN);
      sessionStorage.removeItem(SS_PARTICIPANT_ID);
      sessionStorage.removeItem(SS_HOST_ID);
      sessionStorage.removeItem(SS_ROLE);
    }
    setApiError(message);
    setCreds(null);
  }

  // ---------------------------------------------------------------------------
  // Resolve credentials on mount (SSR-safe)
  // ---------------------------------------------------------------------------

  useEffect(() => {
    if (typeof window === "undefined") return;

    const token = sessionStorage.getItem(SS_TOKEN);
    const participantId = sessionStorage.getItem(SS_PARTICIPANT_ID);
    const hostId = sessionStorage.getItem(SS_HOST_ID);
    const role = sessionStorage.getItem(SS_ROLE);

    if (token && participantId && hostId && (role === "host" || role === "guest")) {
      setCreds({ token, participantId, hostId, role });
    }
    setCredsLoading(false);
  }, []);

  // ---------------------------------------------------------------------------
  // Initialize recorder + SSE once credentials are available
  // ---------------------------------------------------------------------------

  const handleEvent = useCallback(
    (evt: ServerEvent) => {
      switch (evt.type) {
        case "presence":
          setParticipants(evt.participants);
          break;
        case "recordStart":
          // Schedule local recording at the server-synced timestamp
          recorderRef.current?.scheduleRecordStart(evt.recordStartAt);
          break;
        case "recordStop":
          void recorderRef.current?.stop();
          if (elapsedRef.current) {
            clearInterval(elapsedRef.current);
            elapsedRef.current = null;
          }
          break;
      }
    },
    []
  );

  useEffect(() => {
    if (!creds) return;
    if (typeof window === "undefined") return;

    const callbacks: RecorderEvents = {
      onStateChange: (state) => {
        setRecState(state);
        if (state === "recording") {
          setElapsedSec(0);
          elapsedRef.current = setInterval(() => {
            setElapsedSec((s) => s + 1);
          }, 1_000);
        }
        if (state === "stopped" && elapsedRef.current) {
          clearInterval(elapsedRef.current);
          elapsedRef.current = null;
        }
      },
      onLevelUpdate: setMicLevel,
      onError: setMicError,
      onChunkUploaded: () => setChunksUploaded((n) => n + 1),
      // Fired once getUserMedia succeeds — attach to the video preview tile
      onStream: (stream) => {
        if (typeof window !== "undefined") setLocalStream(stream);
      },
    };

    const client = new RecorderClient(callbacks);
    client.setAuthToken(creds.token);
    client.setMonitorEnabled(false);
    recorderRef.current = client;

    // Async init (getUserMedia + IndexedDB) with session existence preflight.
    client.init().then(async () => {
      const stateRes = await fetch(
        `/api/session/${sessionId}/state?pid=${encodeURIComponent(creds.participantId)}`
      );
      if (!stateRes.ok) {
        clearStoredCredsAndFallback(
          "Session not found or expired. Please rejoin with the room code."
        );
        return;
      }
      // Connect SSE after mic is ready
      client.connectEvents(sessionId, creds.participantId, handleEvent);
    });

    return () => {
      client.destroy();
      recorderRef.current = null;
      if (elapsedRef.current) clearInterval(elapsedRef.current);
    };
    // handleEvent is stable (useCallback with no deps)
  }, [creds, sessionId, handleEvent]);

  // ---------------------------------------------------------------------------
  // Host controls
  // ---------------------------------------------------------------------------

  async function handleStart() {
    if (!creds) return;
    setApiError(null);
    try {
      const res = await fetch(`/api/session/${sessionId}/start`, {
        method: "POST",
        headers: { Authorization: `Bearer ${creds.token}` },
      });
      if (res.status === 404) {
        clearStoredCredsAndFallback("Session not found or expired. Please rejoin.");
        return;
      }
      if (!res.ok) {
        const text = await res.text();
        throw new Error(text || `Server error ${res.status}`);
      }
      // SSE recordStart event will trigger actual recording on all clients
      // (including host itself via the SSE path for consistency)
    } catch (err) {
      setApiError(
        err instanceof Error ? err.message : "Failed to start recording."
      );
    }
  }

  async function handleStop() {
    if (!creds) return;
    setApiError(null);
    try {
      const res = await fetch(`/api/session/${sessionId}/stop`, {
        method: "POST",
        headers: { Authorization: `Bearer ${creds.token}` },
      });
      if (res.status === 404) {
        clearStoredCredsAndFallback("Session not found or expired. Please rejoin.");
        return;
      }
      if (!res.ok) {
        const text = await res.text();
        throw new Error(text || `Server error ${res.status}`);
      }
      // SSE recordStop event triggers actual stop
    } catch (err) {
      setApiError(
        err instanceof Error ? err.message : "Failed to stop recording."
      );
    }
  }

  // ---------------------------------------------------------------------------
  // Host: mix in browser from GCS chunks and download locally
  // ---------------------------------------------------------------------------

  async function handleMix() {
    if (!creds) return;
    setMixing(true);
    setMixError(null);
    try {
      // Chunks may still be uploading right after stop; poll briefly before failing.
      let payload:
        | {
            sessionId: string;
            participants: {
              participantId: string;
              recordStartAt: number;
              chunks: { index: number; objectName: string; url: string }[];
            }[];
          }
        | null = null;

      for (let attempt = 0; attempt < 5; attempt++) {
        const res = await fetch(`/api/storage/download-urls/${sessionId}`, {
          method: "GET",
          headers: { Authorization: `Bearer ${creds.token}` },
        });
        if (!res.ok) {
          const text = await res.text();
          throw new Error(text || `Failed to fetch chunk URLs (${res.status})`);
        }
        const candidate = (await res.json()) as {
          sessionId: string;
          participants: {
            participantId: string;
            recordStartAt: number;
            chunks: { index: number; objectName: string; url: string }[];
          }[];
        };
        const chunkCount = candidate.participants.reduce(
          (sum, p) => sum + p.chunks.length,
          0
        );
        if (chunkCount > 0) {
          payload = candidate;
          break;
        }
        await new Promise((r) => setTimeout(r, 1200));
      }

      if (!payload) {
        throw new Error(
          "No chunks found in storage yet. Wait a few seconds and try again."
        );
      }

      const mixed = await mixSessionInBrowser({
        sessionId: payload.sessionId,
        participants: payload.participants,
      });
      const url = URL.createObjectURL(mixed);
      setMixBlobUrl((prev) => {
        if (prev) URL.revokeObjectURL(prev);
        return url;
      });
    } catch (err) {
      const detail =
        err instanceof Error ? err.message : JSON.stringify(err);
      setMixError(`Failed to mix recording. ${detail}`);
    } finally {
      setMixing(false);
    }
  }

  // ---------------------------------------------------------------------------
  // Copy shareable link
  // ---------------------------------------------------------------------------

  function handleCopyLink() {
    if (typeof window === "undefined") return;
    const url = `${window.location.origin}/room/${sessionId}`;
    navigator.clipboard.writeText(url).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2_000);
    });
  }

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  // Still resolving sessionStorage
  if (credsLoading) {
    return (
      <main style={{ ...pageStyle, justifyContent: "center" }}>
        <p style={{ color: "var(--muted)", fontSize: 14 }}>Loading…</p>
      </main>
    );
  }

  // No credentials — show inline join form
  if (!creds) {
    return (
      <InlineJoinForm
        sessionId={sessionId}
        onJoined={(newCreds) => setCreds(newCreds)}
      />
    );
  }

  const isHost = creds.role === "host";
  const combinedError = micError ?? apiError;

  return (
    <main style={pageStyle}>
      {/* ------------------------------------------------------------------ */}
      {/* Header — room code + copy link                                      */}
      {/* ------------------------------------------------------------------ */}
      <header style={headerStyle}>
        <span
          style={{
            fontSize: 16,
            fontWeight: 700,
            color: "var(--fg)",
          }}
        >
          LocalRecorde
        </span>
        <div style={codeBoxStyle}>
          <span style={codeTextStyle} aria-label={`Room code ${sessionId}`}>
            {sessionId}
          </span>
          <button
            onClick={handleCopyLink}
            style={copyBtnStyle}
            aria-label="Copy shareable link"
          >
            {copied ? "Copied!" : "Copy link"}
          </button>
        </div>
      </header>

      {/* API error banner (outside RecorderPanel to keep it host-visible) */}
      {apiError && !micError && (
        <p style={errorStyle} role="alert">
          {apiError}
        </p>
      )}

      {/* ------------------------------------------------------------------ */}
      {/* Recorder panel                                                       */}
      {/* ------------------------------------------------------------------ */}
      <RecorderPanel
        participants={participants}
        recState={recState}
        micLevel={micLevel}
        elapsedSec={elapsedSec}
        isHost={isHost}
        errorMessage={combinedError}
        chunksUploaded={chunksUploaded}
        localParticipantId={creds.participantId}
        localStream={localStream}
        monitorEnabled={monitorEnabled}
        onToggleMonitor={(enabled) => {
          setMonitorEnabled(enabled);
          recorderRef.current?.setMonitorEnabled(enabled);
        }}
        onStart={handleStart}
        onStop={handleStop}
      />

      {/* ------------------------------------------------------------------ */}
      {/* Host-only: mix + download (shown once recording has stopped)        */}
      {/* ------------------------------------------------------------------ */}
      {isHost && recState === "stopped" && (
        <section
          style={{
            background: "var(--panel)",
            borderRadius: 16,
            padding: "20px 22px",
            width: "100%",
            maxWidth: 480,
            display: "flex",
            flexDirection: "column",
            gap: 14,
          }}
        >
          <h3 style={{ margin: 0, fontSize: 15, fontWeight: 700 }}>
            Recording
          </h3>

          {!mixBlobUrl && (
            <>
              <p style={{ margin: 0, fontSize: 13, color: "var(--muted)" }}>
                Download chunks from GCS and mix in this browser with ffmpeg.wasm.
              </p>
              <button
                onClick={handleMix}
                disabled={mixing}
                style={{
                  background: "var(--accent)",
                  color: "#fff",
                  opacity: mixing ? 0.6 : 1,
                  cursor: mixing ? "wait" : "pointer",
                  alignSelf: "flex-start",
                }}
              >
                {mixing ? "Mixing in browser…" : "Mix in browser"}
              </button>
            </>
          )}

          {mixError && (
            <p style={errorStyle} role="alert">
              {mixError}
            </p>
          )}

          {mixBlobUrl && (
            <>
              <a
                href={mixBlobUrl}
                download={`${sessionId}-mix.webm`}
                style={{
                  background: "var(--ok)",
                  color: "#06281a",
                  fontWeight: 700,
                  textDecoration: "none",
                  borderRadius: 8,
                  padding: "10px 16px",
                  fontSize: 14,
                  alignSelf: "flex-start",
                }}
              >
                Download mixed file
              </a>
            </>
          )}
        </section>
      )}
    </main>
  );
}
