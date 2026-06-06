import { NextResponse } from "next/server";
import { nanoid } from "nanoid";
import { getSession, addParticipant } from "@/lib/store";
import { issueJoinToken } from "@/lib/token";
import type { JoinSessionRequest, JoinSessionResponse, Participant } from "@/lib/types";

export async function POST(
  req: Request,
  { params }: { params: { id: string } },
): Promise<NextResponse> {
  const session = getSession(params.id);
  if (!session) {
    return NextResponse.json({ error: "Session not found" }, { status: 404 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { name } = body as Partial<JoinSessionRequest>;
  if (!name || typeof name !== "string" || name.trim().length === 0) {
    return NextResponse.json({ error: "name is required" }, { status: 400 });
  }

  const participantId = nanoid();
  const now = Date.now();

  const participant: Participant = {
    id: participantId,
    name: name.trim(),
    joinedAt: now,
    connected: false,
  };

  const updated = addParticipant(params.id, participant);
  if (!updated) {
    // Race: session was removed between getSession and addParticipant
    return NextResponse.json({ error: "Session not found" }, { status: 404 });
  }

  const token = await issueJoinToken({ sessionId: params.id, participantId, role: "guest" });

  const response: JoinSessionResponse = {
    participantId,
    token,
    session: updated,
  };

  return NextResponse.json(response, { status: 201 });
}
