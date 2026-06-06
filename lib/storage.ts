import { Storage } from "@google-cloud/storage";
import { getSession } from "@/lib/store";
import type { ChunkMeta, ParticipantChunks } from "@/lib/types";

const SAFE_ID = /^[A-Za-z0-9_-]+$/;
const CHUNK_FILE = /^\d+\.webm$/;

const bucketName = process.env.GCP_STORAGE_BUCKET ?? "poc-storage-v1";
const projectId = process.env.GCP_PROJECT_ID;
const serviceAccountJson = process.env.GCP_SERVICE_ACCOUNT_KEY_JSON;
const signedUrlTtlMs = Number(process.env.GCP_SIGNED_URL_TTL_MS ?? 15 * 60 * 1000);

function assertSafeId(value: string, field: string): void {
  if (!SAFE_ID.test(value)) {
    throw new Error(`Invalid ${field}: "${value}". Must match ^[A-Za-z0-9_-]+$`);
  }
}

function getStorageClient(): Storage {
  if (!bucketName) {
    throw new Error("Missing GCP_STORAGE_BUCKET");
  }

  if (serviceAccountJson) {
    const credentials = JSON.parse(serviceAccountJson) as {
      client_email: string;
      private_key: string;
    };
    return new Storage({ projectId, credentials });
  }

  return new Storage({ projectId });
}

function objectNameForChunk(meta: ChunkMeta): string {
  assertSafeId(meta.sessionId, "sessionId");
  assertSafeId(meta.participantId, "participantId");
  if (!Number.isInteger(meta.chunkIndex) || meta.chunkIndex < 0) {
    throw new Error(`Invalid chunkIndex: ${meta.chunkIndex}`);
  }
  return `${meta.sessionId}/${meta.participantId}/${meta.chunkIndex}.webm`;
}

export async function getChunkUploadSignedUrl(meta: ChunkMeta): Promise<{
  uploadUrl: string;
  objectName: string;
}> {
  const storage = getStorageClient();
  const objectName = objectNameForChunk(meta);
  const file = storage.bucket(bucketName).file(objectName);

  const [uploadUrl] = await file.getSignedUrl({
    version: "v4",
    action: "write",
    expires: Date.now() + signedUrlTtlMs,
    contentType: meta.mimeType || "video/webm",
  });

  return { uploadUrl, objectName };
}

export async function uploadChunk(meta: ChunkMeta, data: ArrayBuffer): Promise<{ objectName: string }> {
  const storage = getStorageClient();
  const objectName = objectNameForChunk(meta);
  const file = storage.bucket(bucketName).file(objectName);

  await file.save(Buffer.from(data), {
    contentType: meta.mimeType || "video/webm",
    resumable: false,
    validation: false,
    metadata: {
      metadata: {
        sessionId: meta.sessionId,
        participantId: meta.participantId,
        chunkIndex: String(meta.chunkIndex),
        recordStartAt: String(meta.recordStartAt),
      },
    },
  });

  return { objectName };
}

export async function listSessionChunksWithSignedUrls(
  sessionId: string,
  opts?: { hostOnly?: boolean }
): Promise<{ participants: ParticipantChunks[] }> {
  assertSafeId(sessionId, "sessionId");

  const session = getSession(sessionId);
  const defaultStartAt = session?.recordStartAt ?? session?.createdAt ?? Date.now();

  const storage = getStorageClient();
  const [files] = await storage.bucket(bucketName).getFiles({
    prefix: `${sessionId}/`,
  });

  const grouped = new Map<
    string,
    { recordStartAt: number | null; chunks: { index: number; objectName: string }[] }
  >();

  for (const file of files) {
    const parts = file.name.split("/");
    if (parts.length !== 3) continue;
    const [sid, participantId, fileName] = parts;
    if (sid !== sessionId) continue;
    if (!SAFE_ID.test(participantId)) continue;
    if (!CHUNK_FILE.test(fileName)) continue;

    const index = Number.parseInt(fileName.slice(0, -".webm".length), 10);
    if (!Number.isInteger(index) || index < 0) continue;

    const recordStartAtRaw = file.metadata?.metadata?.recordStartAt;
    const parsedRecordStartAt = Number.parseInt(
      typeof recordStartAtRaw === "string" ? recordStartAtRaw : "",
      10
    );
    const startAt = Number.isFinite(parsedRecordStartAt) ? parsedRecordStartAt : null;

    const curr = grouped.get(participantId) ?? { recordStartAt: null, chunks: [] };
    curr.chunks.push({ index, objectName: file.name });
    if (startAt !== null) {
      curr.recordStartAt =
        curr.recordStartAt === null ? startAt : Math.min(curr.recordStartAt, startAt);
    }
    grouped.set(participantId, curr);
  }

  const participants: ParticipantChunks[] = [];
  for (const [participantId, groupedData] of grouped.entries()) {
    const chunksRaw = groupedData.chunks;
    chunksRaw.sort((a, b) => a.index - b.index);
    const chunkUrls = await Promise.all(
      chunksRaw.map(async (chunk) => {
        const [url] = await storage.bucket(bucketName).file(chunk.objectName).getSignedUrl({
          version: "v4",
          action: "read",
          expires: Date.now() + signedUrlTtlMs,
        });
        return {
          index: chunk.index,
          objectName: chunk.objectName,
          url,
        };
      })
    );

    participants.push({
      participantId,
      recordStartAt: groupedData.recordStartAt ?? defaultStartAt,
      chunks: chunkUrls,
    });
  }

  participants.sort((a, b) => a.participantId.localeCompare(b.participantId));
  return { participants };
}

export { SAFE_ID };
