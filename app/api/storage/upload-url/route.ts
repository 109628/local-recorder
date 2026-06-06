export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { getSession } from "@/lib/store";
import { verifyJoinToken } from "@/lib/token";
import { getChunkUploadSignedUrl, SAFE_ID } from "@/lib/storage";
import type { ChunkMeta } from "@/lib/types";

function badRequest(error: string): NextResponse {
  return NextResponse.json({ ok: false, error }, { status: 400 });
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

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return badRequest("Invalid JSON body");
  }

  const meta = body as Partial<ChunkMeta>;
  if (!meta.sessionId || typeof meta.sessionId !== "string") return badRequest("sessionId is required");
  if (!meta.participantId || typeof meta.participantId !== "string") return badRequest("participantId is required");
  if (typeof meta.chunkIndex !== "number" || !Number.isInteger(meta.chunkIndex) || meta.chunkIndex < 0) {
    return badRequest("chunkIndex must be a non-negative integer");
  }
  if (typeof meta.recordStartAt !== "number" || !Number.isFinite(meta.recordStartAt)) {
    return badRequest("recordStartAt must be a number");
  }
  if (!meta.mimeType || typeof meta.mimeType !== "string") return badRequest("mimeType is required");
  if (!SAFE_ID.test(meta.sessionId)) return badRequest("Invalid sessionId format");
  if (!SAFE_ID.test(meta.participantId)) return badRequest("Invalid participantId format");

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
    const signed = await getChunkUploadSignedUrl(meta as ChunkMeta);
    return NextResponse.json({ ok: true, ...signed });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to generate upload URL";
    console.error("[storage/upload-url]", err);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
