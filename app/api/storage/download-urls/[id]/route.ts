export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { getSession } from "@/lib/store";
import { verifyJoinToken } from "@/lib/token";
import { listSessionChunksWithSignedUrls, SAFE_ID } from "@/lib/storage";

export async function GET(
  req: Request,
  { params }: { params: { id: string } }
): Promise<NextResponse> {
  const sessionId = params.id;
  if (!SAFE_ID.test(sessionId)) {
    return NextResponse.json({ error: "Invalid session id format" }, { status: 400 });
  }

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

  if (claims.sessionId !== sessionId) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const session = getSession(sessionId);
  if (!session) {
    return NextResponse.json({ error: "Session not found" }, { status: 404 });
  }
  if (claims.participantId !== session.hostId) {
    return NextResponse.json({ error: "Only host can request download URLs" }, { status: 403 });
  }

  try {
    const listing = await listSessionChunksWithSignedUrls(sessionId);
    return NextResponse.json({
      sessionId,
      participants: listing.participants,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to list session chunks";
    console.error(`[storage/download-urls/${sessionId}]`, err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
