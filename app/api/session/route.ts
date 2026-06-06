import { NextResponse } from "next/server";
import { nanoid } from "nanoid";
import { createSession, addParticipant } from "@/lib/store";
import { issueJoinToken } from "@/lib/token";
import type { CreateSessionResponse, Participant, Session } from "@/lib/types";

export async function POST(): Promise<NextResponse<CreateSessionResponse>> {
  const sessionId = nanoid();
  const hostId = nanoid();

  const now = Date.now();

  const session: Session = {
    id: sessionId,
    hostId,
    createdAt: now,
    recordStartAt: null,
    participants: {},
  };

  createSession(session);

  const hostParticipant: Participant = {
    id: hostId,
    name: "Host",
    joinedAt: now,
    connected: false,
  };

  addParticipant(sessionId, hostParticipant);

  const token = await issueJoinToken({ sessionId, participantId: hostId, role: "host" });

  return NextResponse.json({ sessionId, hostId, token });
}
