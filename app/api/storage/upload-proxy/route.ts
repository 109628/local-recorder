export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { getSession } from "@/lib/store";
import { verifyJoinToken } from "@/lib/token";
import { SAFE_ID, uploadChunk } from "@/lib/storage";
import type { ChunkMeta } from "@/lib/types";

function badRequest(error: string): NextResponse {
  return NextResponse.json({ ok: false, error }, { status: 400 });
}

function parseChunkMeta(req: Request): ChunkMeta | null {
  const url = new URL(req.url);
  const sessionId = url.searchParams.get("sessionId");
  const participantId = url.searchParams.get("participantId");
  const chunkIndexRaw = url.searchParams.get("chunkIndex");
  const recordStartAtRaw = url.searchParams.get("recordStartAt");
  const mimeType = req.headers.get("content-type") ?? "video/webm";

  if (!sessionId || !participantId || !chunkIndexRaw || !recordStartAtRaw) {
    return null;
  }

  const chunkIndex = Number(chunkIndexRaw);
  const recordStartAt = Number(recordStartAtRaw);
  if (!Number.isInteger(chunkIndex) || chunkIndex < 0) return null;
  if (!Number.isFinite(recordStartAt)) return null;
  if (!SAFE_ID.test(sessionId) || !SAFE_ID.test(participantId)) return null;

  return { sessionId, participantId, chunkIndex, recordStartAt, mimeType };
}

export async function POST(req: Request): Promise<NextResponse> {
  const authHeader = req.headers.get("authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return NextResponse.json(
      { ok: false, error: "Missing or invalid Authorization header" },
      { status: 401 }
    );
  }

  const token = authHeader.slice(7);
  let claims: Awaited<ReturnType<typeof verifyJoinToken>>;
  try {
    claims = await verifyJoinToken(token);
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid or expired token" }, { status: 401 });
  }

  const meta = parseChunkMeta(req);
  if (!meta) {
    return badRequest("Invalid upload metadata in query params");
  }

  if (claims.sessionId !== meta.sessionId || claims.participantId !== meta.participantId) {
    return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
  }

  const session = getSession(meta.sessionId);
  if (!session) {
    return NextResponse.json({ ok: false, error: "Session not found" }, { status: 404 });
  }
  if (!session.participants[meta.participantId]) {
    return NextResponse.json({ ok: false, error: "Participant not found" }, { status: 404 });
  }

  try {
    const body = await req.arrayBuffer();
    if (body.byteLength === 0) return badRequest("Empty upload body");
    const saved = await uploadChunk(meta, body);
    return NextResponse.json({ ok: true, ...saved });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to upload chunk";
    console.error("[storage/upload-proxy]", err);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
