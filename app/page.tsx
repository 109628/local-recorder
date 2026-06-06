"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { CreateSessionResponse, JoinSessionResponse } from "@/lib/types";
import { SS_TOKEN, SS_PARTICIPANT_ID, SS_HOST_ID, SS_ROLE } from "@/lib/session-keys";

// ---------------------------------------------------------------------------
// Styles (CSS variable–based)
// ---------------------------------------------------------------------------

const pageStyle: React.CSSProperties = {
  minHeight: "100vh",
  display: "flex",
  flexDirection: "column",
  alignItems: "center",
  justifyContent: "center",
  padding: 24,
  gap: 0,
};

const cardStyle: React.CSSProperties = {
  background: "var(--panel)",
  borderRadius: 16,
  padding: "40px 36px",
  width: "100%",
  maxWidth: 400,
  display: "flex",
  flexDirection: "column",
  gap: 28,
};

const sectionStyle: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 12,
};

const dividerStyle: React.CSSProperties = {
  border: "none",
  borderTop: "1px solid #2a2e38",
  margin: 0,
};

const labelStyle: React.CSSProperties = {
  fontSize: 12,
  fontWeight: 600,
  color: "var(--muted)",
  textTransform: "uppercase",
  letterSpacing: "0.06em",
};

const errorStyle: React.CSSProperties = {
  fontSize: 13,
  color: "var(--danger)",
  background: "#2d1a1e",
  border: "1px solid var(--danger)",
  borderRadius: 8,
  padding: "8px 12px",
};

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function HomePage() {
  const router = useRouter();

  // ----- Start a session -----
  const [startLoading, setStartLoading] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);

  // ----- Join with code -----
  const [roomCode, setRoomCode] = useState("");
  const [joinName, setJoinName] = useState("");
  const [joinLoading, setJoinLoading] = useState(false);
  const [joinError, setJoinError] = useState<string | null>(null);

  // ---------------------------------------------------------------------------
  // Handlers
  // ---------------------------------------------------------------------------

  async function handleStartSession() {
    setStartLoading(true);
    setStartError(null);
    try {
      const res = await fetch("/api/session", { method: "POST" });
      if (!res.ok) {
        const text = await res.text();
        throw new Error(text || `Server error ${res.status}`);
      }
      const data = (await res.json()) as CreateSessionResponse;

      // Persist host credentials for the room page
      sessionStorage.setItem(SS_TOKEN, data.token);
      sessionStorage.setItem(SS_PARTICIPANT_ID, data.hostId);
      sessionStorage.setItem(SS_HOST_ID, data.hostId);
      sessionStorage.setItem(SS_ROLE, "host");

      router.push(`/room/${data.sessionId}`);
    } catch (err) {
      setStartError(
        err instanceof Error ? err.message : "Failed to create session."
      );
    } finally {
      setStartLoading(false);
    }
  }

  async function handleJoinSession(e: React.FormEvent) {
    e.preventDefault();
    const code = roomCode.trim();
    const name = joinName.trim();
    if (!code || !name) return;

    setJoinLoading(true);
    setJoinError(null);
    try {
      const res = await fetch(`/api/session/${code}/join`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      if (!res.ok) {
        const text = await res.text();
        throw new Error(text || `Server error ${res.status}`);
      }
      const data = (await res.json()) as JoinSessionResponse;

      // Persist guest credentials for the room page
      sessionStorage.setItem(SS_TOKEN, data.token);
      sessionStorage.setItem(SS_PARTICIPANT_ID, data.participantId);
      sessionStorage.setItem(SS_HOST_ID, data.session.hostId);
      sessionStorage.setItem(SS_ROLE, "guest");

      router.push(`/room/${code}`);
    } catch (err) {
      setJoinError(
        err instanceof Error ? err.message : "Failed to join session."
      );
    } finally {
      setJoinLoading(false);
    }
  }

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  return (
    <main style={pageStyle}>
      <div style={cardStyle}>
        {/* Brand / title */}
        <div style={{ textAlign: "center" }}>
          <h1
            style={{
              margin: 0,
              fontSize: 26,
              fontWeight: 700,
              color: "var(--fg)",
              letterSpacing: "-0.02em",
            }}
          >
            LocalRecorde
          </h1>
          <p
            style={{
              margin: "6px 0 0",
              fontSize: 13,
              color: "var(--muted)",
            }}
          >
            Podcast-quality local recording — everyone keeps their own track.
          </p>
        </div>

        {/* Start session */}
        <div style={sectionStyle}>
          <span style={labelStyle}>Host a session</span>
          {startError && <p style={errorStyle}>{startError}</p>}
          <button
            onClick={handleStartSession}
            disabled={startLoading}
            style={{
              background: "var(--accent)",
              color: "#fff",
              opacity: startLoading ? 0.6 : 1,
              cursor: startLoading ? "not-allowed" : "pointer",
              width: "100%",
            }}
            aria-label="Create a new recording session"
          >
            {startLoading ? "Creating…" : "Start a session"}
          </button>
        </div>

        <hr style={dividerStyle} aria-hidden="true" />

        {/* Join with code */}
        <div style={sectionStyle}>
          <span style={labelStyle}>Join with a room code</span>
          {joinError && <p style={errorStyle}>{joinError}</p>}
          <form
            onSubmit={handleJoinSession}
            style={{ display: "flex", flexDirection: "column", gap: 10 }}
          >
            <input
              type="text"
              placeholder="Room code"
              value={roomCode}
              onChange={(e) => setRoomCode(e.target.value)}
              required
              autoComplete="off"
              spellCheck={false}
              style={{ width: "100%" }}
              aria-label="Room code"
            />
            <input
              type="text"
              placeholder="Your name"
              value={joinName}
              onChange={(e) => setJoinName(e.target.value)}
              required
              maxLength={48}
              style={{ width: "100%" }}
              aria-label="Your display name"
            />
            <button
              type="submit"
              disabled={joinLoading || !roomCode.trim() || !joinName.trim()}
              style={{
                background: "#2a2e38",
                color: "var(--fg)",
                border: "1px solid #3a3f4e",
                opacity:
                  joinLoading || !roomCode.trim() || !joinName.trim()
                    ? 0.5
                    : 1,
                cursor:
                  joinLoading || !roomCode.trim() || !joinName.trim()
                    ? "not-allowed"
                    : "pointer",
              }}
            >
              {joinLoading ? "Joining…" : "Join session"}
            </button>
          </form>
        </div>
      </div>
    </main>
  );
}
