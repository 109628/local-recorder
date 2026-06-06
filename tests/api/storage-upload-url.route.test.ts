import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createSession, __resetStoreForTests } from "@/lib/store";

const { verifyJoinTokenMock, getChunkUploadSignedUrlMock } = vi.hoisted(() => ({
  verifyJoinTokenMock: vi.fn(),
  getChunkUploadSignedUrlMock: vi.fn(),
}));

vi.mock("@/lib/token", () => ({
  verifyJoinToken: verifyJoinTokenMock,
}));

vi.mock("@/lib/storage", async () => {
  const actual = await vi.importActual<typeof import("@/lib/storage")>("@/lib/storage");
  return {
    ...actual,
    getChunkUploadSignedUrl: getChunkUploadSignedUrlMock,
  };
});

import { POST } from "@/app/api/storage/upload-url/route";

describe("POST /api/storage/upload-url", () => {
  beforeEach(() => {
    __resetStoreForTests();
    verifyJoinTokenMock.mockReset();
    getChunkUploadSignedUrlMock.mockReset();
  });

  afterEach(() => {
    __resetStoreForTests();
  });

  it("returns 401 when Authorization header is missing", async () => {
    const req = new Request("http://localhost/api/storage/upload-url", {
      method: "POST",
      body: JSON.stringify({}),
      headers: { "content-type": "application/json" },
    });
    const res = await POST(req);
    expect(res.status).toBe(401);
  });

  it("returns 403 when token claims do not match payload", async () => {
    verifyJoinTokenMock.mockResolvedValue({
      sessionId: "s1",
      participantId: "p1",
      role: "guest",
    });
    const req = new Request("http://localhost/api/storage/upload-url", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: "Bearer test-token",
      },
      body: JSON.stringify({
        sessionId: "s1",
        participantId: "p2",
        chunkIndex: 0,
        recordStartAt: Date.now(),
        mimeType: "audio/webm",
      }),
    });
    const res = await POST(req);
    expect(res.status).toBe(403);
  });

  it("returns 404 when session is missing", async () => {
    verifyJoinTokenMock.mockResolvedValue({
      sessionId: "s1",
      participantId: "p1",
      role: "guest",
    });
    const req = new Request("http://localhost/api/storage/upload-url", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: "Bearer test-token",
      },
      body: JSON.stringify({
        sessionId: "s1",
        participantId: "p1",
        chunkIndex: 0,
        recordStartAt: Date.now(),
        mimeType: "audio/webm",
      }),
    });
    const res = await POST(req);
    expect(res.status).toBe(404);
  });

  it("returns signed URL payload for valid request", async () => {
    createSession({
      id: "s1",
      hostId: "host1",
      createdAt: Date.now(),
      recordStartAt: null,
      participants: {
        p1: { id: "p1", name: "User 1", joinedAt: Date.now(), connected: true },
      },
    });
    verifyJoinTokenMock.mockResolvedValue({
      sessionId: "s1",
      participantId: "p1",
      role: "guest",
    });
    getChunkUploadSignedUrlMock.mockResolvedValue({
      uploadUrl: "https://signed.example/upload",
      objectName: "s1/p1/0.webm",
    });

    const req = new Request("http://localhost/api/storage/upload-url", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: "Bearer test-token",
      },
      body: JSON.stringify({
        sessionId: "s1",
        participantId: "p1",
        chunkIndex: 0,
        recordStartAt: Date.now(),
        mimeType: "audio/webm",
      }),
    });
    const res = await POST(req);
    expect(res.status).toBe(200);
    expect(getChunkUploadSignedUrlMock).toHaveBeenCalledTimes(1);

    const body = (await res.json()) as {
      ok: boolean;
      uploadUrl: string;
      objectName: string;
    };
    expect(body).toEqual({
      ok: true,
      uploadUrl: "https://signed.example/upload",
      objectName: "s1/p1/0.webm",
    });
  });
});
