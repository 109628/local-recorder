"use client";

/**
 * RecorderPanel — purely presentational component.
 * All state is lifted to the room page; this component only renders.
 * No recording logic lives here — that belongs in RecorderClient.
 *
 * Video grid layout:
 *  - Local tile: live <video> preview (muted to avoid feedback) with rec dot + timer overlay.
 *  - Remote tiles: avatar/initials placeholders only — there is no live video relay in
 *    this local-record architecture. Tiles are presence indicators, not live streams.
 */

import { useEffect, useRef } from "react";
import type { Participant } from "@/lib/types";

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface RecorderPanelProps {
  /** All participants currently in the session (from SSE presence events) */
  participants: Participant[];
  /** Current local recording state */
  recState: "idle" | "mic-ready" | "recording" | "stopped";
  /** RMS level 0–1 from analyser; drives the input meter bar */
  micLevel: number;
  /** Elapsed recording seconds (computed by parent) */
  elapsedSec: number;
  /** True if the local user is the session host */
  isHost: boolean;
  /** Non-null when a permission/device error has occurred */
  errorMessage: string | null;
  /** Number of chunks successfully uploaded this session */
  chunksUploaded: number;
  /** The local participant's participantId — used to label the local tile */
  localParticipantId: string;
  /** Live MediaStream from RecorderClient (audio+video). Null until init() resolves. */
  localStream: MediaStream | null;
  /** True when local monitor is enabled */
  monitorEnabled: boolean;
  /** Toggle local monitor output for solo testing */
  onToggleMonitor: (enabled: boolean) => void;
  onStart: () => void;
  onStop: () => void;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatTime(sec: number): string {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return h > 0 ? `${pad(h)}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
}

function getInitials(name: string): string {
  return name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? "")
    .join("");
}

// Deterministic hue from a string — keeps avatar colours stable across renders
function nameHue(name: string): number {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) & 0xffff;
  return h % 360;
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function RecDot({ active }: { active: boolean }) {
  return (
    <span
      aria-label={active ? "Recording" : "Not recording"}
      style={{
        display: "inline-block",
        width: 10,
        height: 10,
        borderRadius: "50%",
        background: active ? "var(--danger)" : "var(--muted)",
        boxShadow: active ? "0 0 8px var(--danger)" : "none",
        animation: active ? "pulse 1.4s ease-in-out infinite" : "none",
        flexShrink: 0,
      }}
    />
  );
}

function MicMeter({ level }: { level: number }) {
  const pct = Math.round(level * 100);
  const colour =
    level > 0.8 ? "var(--danger)" : level > 0.4 ? "#f59e0b" : "var(--ok)";

  return (
    <div
      aria-label={`Mic level ${pct}%`}
      style={{
        height: 6,
        borderRadius: 4,
        background: "#2a2e38",
        overflow: "hidden",
        width: "100%",
      }}
    >
      <div
        style={{
          height: "100%",
          width: `${pct}%`,
          background: colour,
          transition: "width 80ms linear",
          borderRadius: 4,
        }}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Local video tile
// ---------------------------------------------------------------------------

interface LocalTileProps {
  stream: MediaStream | null;
  name: string;
  isRecording: boolean;
  elapsedSec: number;
}

function LocalTile({ stream, name, isRecording, elapsedSec }: LocalTileProps) {
  const videoRef = useRef<HTMLVideoElement>(null);

  // Attach stream to the <video> element via srcObject.
  // Guard typeof window so this is safe when rendered on the server.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const el = videoRef.current;
    if (!el) return;
    el.srcObject = stream;
  }, [stream]);

  return (
    <div style={tileStyle}>
      {stream ? (
        <video
          ref={videoRef}
          autoPlay
          muted        // muted on local preview to prevent audio feedback
          playsInline
          style={{
            width: "100%",
            height: "100%",
            objectFit: "cover",
            borderRadius: 10,
            display: "block",
            background: "#000",
          }}
          aria-label={`Local camera preview for ${name}`}
        />
      ) : (
        <AvatarPlaceholder name={name} connected />
      )}

      {/* Rec dot + timer overlay */}
      <div style={tileOverlayStyle}>
        <RecDot active={isRecording} />
        {isRecording && (
          <span
            aria-live="polite"
            aria-label={`Elapsed time ${formatTime(elapsedSec)}`}
            style={timerStyle}
          >
            {formatTime(elapsedSec)}
          </span>
        )}
        <span style={tileNameStyle}>{name} (you)</span>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Remote presence tile (no live stream — placeholder only)
// ---------------------------------------------------------------------------

interface RemoteTileProps {
  participant: Participant;
}

function RemoteTile({ participant }: RemoteTileProps) {
  return (
    <div style={tileStyle} aria-label={`Participant tile for ${participant.name}`}>
      <AvatarPlaceholder name={participant.name} connected={participant.connected} />
      <div style={tileOverlayStyle}>
        {/* Connection dot */}
        <span
          aria-hidden="true"
          style={{
            width: 8,
            height: 8,
            borderRadius: "50%",
            background: participant.connected ? "var(--ok)" : "var(--muted)",
            flexShrink: 0,
          }}
        />
        <span style={tileNameStyle}>{participant.name}</span>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Avatar placeholder (used in both tiles when no live video is available)
// ---------------------------------------------------------------------------

function AvatarPlaceholder({ name, connected }: { name: string; connected: boolean }) {
  const hue = nameHue(name);
  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        borderRadius: 10,
        background: `hsl(${hue}, 35%, 22%)`,
        opacity: connected ? 1 : 0.5,
      }}
    >
      <span
        style={{
          fontSize: 32,
          fontWeight: 700,
          color: `hsl(${hue}, 60%, 72%)`,
          userSelect: "none",
        }}
      >
        {getInitials(name) || "?"}
      </span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tile styles (shared between local + remote)
// ---------------------------------------------------------------------------

const tileStyle: React.CSSProperties = {
  position: "relative",
  aspectRatio: "16 / 9",
  borderRadius: 10,
  overflow: "hidden",
  background: "#0a0c10",
  border: "1px solid #2a2e38",
};

const tileOverlayStyle: React.CSSProperties = {
  position: "absolute",
  bottom: 0,
  left: 0,
  right: 0,
  display: "flex",
  alignItems: "center",
  gap: 6,
  padding: "6px 10px",
  background: "linear-gradient(transparent, rgba(0,0,0,0.72))",
};

const tileNameStyle: React.CSSProperties = {
  fontSize: 12,
  fontWeight: 600,
  color: "#e6e8eb",
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
  flex: 1,
};

const timerStyle: React.CSSProperties = {
  fontVariantNumeric: "tabular-nums",
  fontSize: 12,
  fontWeight: 600,
  color: "var(--danger)",
  marginLeft: "auto",
};

// ---------------------------------------------------------------------------
// Video grid
// ---------------------------------------------------------------------------

interface VideoGridProps {
  participants: Participant[];
  localParticipantId: string;
  localStream: MediaStream | null;
  isRecording: boolean;
  elapsedSec: number;
}

function VideoGrid({
  participants,
  localParticipantId,
  localStream,
  isRecording,
  elapsedSec,
}: VideoGridProps) {
  const localParticipant = participants.find((p) => p.id === localParticipantId);
  const localName = localParticipant?.name ?? "You";

  // Remote participants are everyone except the local user
  const remotes = participants.filter((p) => p.id !== localParticipantId);

  // Total tiles = local + remotes
  const totalTiles = 1 + remotes.length;
  const cols = Math.ceil(Math.sqrt(totalTiles));

  return (
    <div>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: `repeat(${cols}, 1fr)`,
          gap: 10,
          width: "100%",
        }}
      >
        <LocalTile
          stream={localStream}
          name={localName}
          isRecording={isRecording}
          elapsedSec={elapsedSec}
        />
        {remotes.map((p) => (
          <RemoteTile key={p.id} participant={p} />
        ))}
      </div>
      {/* Caption clarifying that remote tiles are not live streams */}
      {remotes.length > 0 && (
        <p
          style={{
            margin: "8px 0 0",
            fontSize: 11,
            color: "var(--muted)",
            textAlign: "center",
          }}
        >
          Remote tiles show presence only — each participant records locally. No live video relay.
        </p>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main panel
// ---------------------------------------------------------------------------

export default function RecorderPanel({
  participants,
  recState,
  micLevel,
  elapsedSec,
  isHost,
  errorMessage,
  chunksUploaded,
  localParticipantId,
  localStream,
  monitorEnabled,
  onToggleMonitor,
  onStart,
  onStop,
}: RecorderPanelProps) {
  const isRecording = recState === "recording";
  const micReady = recState === "mic-ready" || isRecording;

  return (
    <div
      style={{
        background: "var(--panel)",
        borderRadius: 12,
        padding: 24,
        display: "flex",
        flexDirection: "column",
        gap: 20,
        width: "100%",
        maxWidth: 860,
      }}
    >
      {/* ------------------------------------------------------------------ */}
      {/* Error banner                                                         */}
      {/* ------------------------------------------------------------------ */}
      {errorMessage && (
        <div
          role="alert"
          style={{
            background: "#2d1a1e",
            border: "1px solid var(--danger)",
            borderRadius: 8,
            padding: "10px 14px",
            color: "var(--danger)",
            fontSize: 13,
            lineHeight: 1.5,
          }}
        >
          {errorMessage}
        </div>
      )}

      {/* ------------------------------------------------------------------ */}
      {/* Video grid                                                           */}
      {/* ------------------------------------------------------------------ */}
      <VideoGrid
        participants={participants}
        localParticipantId={localParticipantId}
        localStream={localStream}
        isRecording={isRecording}
        elapsedSec={elapsedSec}
      />

      {/* ------------------------------------------------------------------ */}
      {/* Recording status bar                                                 */}
      {/* ------------------------------------------------------------------ */}
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <RecDot active={isRecording} />
        <span
          style={{
            fontSize: 13,
            fontWeight: 600,
            color: isRecording ? "var(--danger)" : "var(--muted)",
            letterSpacing: "0.04em",
            textTransform: "uppercase",
          }}
        >
          {isRecording ? "REC" : recState === "stopped" ? "STOPPED" : "STANDBY"}
        </span>
        {isRecording && (
          <span
            aria-live="polite"
            aria-label={`Elapsed time ${formatTime(elapsedSec)}`}
            style={{
              marginLeft: "auto",
              fontVariantNumeric: "tabular-nums",
              fontSize: 15,
              color: "var(--fg)",
              fontWeight: 600,
            }}
          >
            {formatTime(elapsedSec)}
          </span>
        )}
      </div>

      {/* ------------------------------------------------------------------ */}
      {/* Mic level meter                                                      */}
      {/* ------------------------------------------------------------------ */}
      {micReady && (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <div
            style={{
              fontSize: 11,
              color: "var(--muted)",
              marginBottom: 6,
              textTransform: "uppercase",
              letterSpacing: "0.06em",
            }}
          >
            Mic Level
          </div>
          <MicMeter level={micLevel} />
          <label
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 8,
              fontSize: 12,
              color: "var(--muted)",
              userSelect: "none",
              width: "fit-content",
            }}
          >
            <input
              type="checkbox"
              checked={monitorEnabled}
              onChange={(e) => onToggleMonitor(e.target.checked)}
              disabled={!localStream}
              aria-label="Enable local mic monitor"
            />
            Monitor my mic (use headphones)
          </label>
        </div>
      )}

      {/* ------------------------------------------------------------------ */}
      {/* Upload progress                                                      */}
      {/* ------------------------------------------------------------------ */}
      {isRecording && (
        <div style={{ fontSize: 12, color: "var(--muted)" }}>
          {chunksUploaded === 0
            ? "Waiting for first upload…"
            : `${chunksUploaded} chunk${chunksUploaded !== 1 ? "s" : ""} uploaded`}
        </div>
      )}

      {/* ------------------------------------------------------------------ */}
      {/* Host controls                                                        */}
      {/* ------------------------------------------------------------------ */}
      {isHost && (
        <div style={{ display: "flex", gap: 10 }}>
          {!isRecording ? (
            <button
              onClick={onStart}
              disabled={recState === "stopped" || !!errorMessage}
              style={{
                flex: 1,
                background: "var(--accent)",
                color: "#fff",
                opacity:
                  recState === "stopped" || !!errorMessage ? 0.4 : 1,
                cursor:
                  recState === "stopped" || !!errorMessage
                    ? "not-allowed"
                    : "pointer",
              }}
              aria-label="Start recording for all participants"
            >
              Start Recording
            </button>
          ) : (
            <button
              onClick={onStop}
              style={{
                flex: 1,
                background: "var(--danger)",
                color: "#fff",
              }}
              aria-label="Stop recording for all participants"
            >
              Stop Recording
            </button>
          )}
        </div>
      )}

      {/* Non-host status message during recording */}
      {!isHost && isRecording && (
        <p
          style={{
            margin: 0,
            fontSize: 13,
            color: "var(--muted)",
            textAlign: "center",
          }}
        >
          Recording in progress — stay connected.
        </p>
      )}

      {/* ------------------------------------------------------------------ */}
      {/* Pulse keyframe — injected once via a style tag                      */}
      {/* ------------------------------------------------------------------ */}
      <style>{`
        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50%       { opacity: 0.3; }
        }
      `}</style>
    </div>
  );
}
