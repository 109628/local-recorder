import { NextResponse } from "next/server";
import { getSession, startRecording } from "@/lib/store";
import { verifyJoinToken } from "@/lib/token";

export async function POST(
  req: Request,
  { params }: { params: { id: string } },
): Promise<NextResponse> {
  const authHeader = req.headers.get("authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return NextResponse.json({ error: "Missing or invalid Authorization header" }, { status: 401 });
  }

  const token = authHeader.slice(7);
  let claims: Awaited<ReturnType<typeof verifyJoinToken>>;
  try {
    claims = await verifyJoinToken(token);
  } catch {
    return NextResponse.json({ error: "Invalid or expired token" }, { status: 401 });
  }

  if (claims.role !== "host" || claims.sessionId !== params.id) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const session = getSession(params.id);
  if (!session) {
    return NextResponse.json({ error: "Session not found" }, { status: 404 });
  }

  // Verify the token's participantId is actually the session host
  if (claims.participantId !== session.hostId) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const recordStartAt = startRecording(params.id);
  if (recordStartAt === undefined) {
    return NextResponse.json({ error: "Session not found" }, { status: 404 });
  }

  return NextResponse.json({ recordStartAt });
}
