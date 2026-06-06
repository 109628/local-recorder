import { NextResponse } from "next/server";
import { getSession } from "@/lib/store";

const SAFE_ID = /^[A-Za-z0-9_-]+$/;

export async function GET(
  req: Request,
  { params }: { params: { id: string } }
): Promise<NextResponse> {
  const sessionId = params.id;
  if (!SAFE_ID.test(sessionId)) {
    return NextResponse.json({ error: "Invalid session id format" }, { status: 400 });
  }

  const session = getSession(sessionId);
  if (!session) {
    return NextResponse.json({ error: "Session not found" }, { status: 404 });
  }

  const url = new URL(req.url);
  const pid = url.searchParams.get("pid");
  if (!pid) {
    return NextResponse.json({ error: "pid query param is required" }, { status: 400 });
  }

  const participant = session.participants[pid];
  if (!participant) {
    return NextResponse.json({ error: "Participant not found in this session" }, { status: 404 });
  }

  return NextResponse.json({
    ok: true,
    sessionId,
    participantId: pid,
    hostId: session.hostId,
  });
}
