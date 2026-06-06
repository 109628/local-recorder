import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { GET } from "@/app/api/session/[id]/state/route";
import { __resetStoreForTests, createSession } from "@/lib/store";

describe("GET /api/session/[id]/state", () => {
  beforeEach(() => {
    __resetStoreForTests();
  });

  afterEach(() => {
    __resetStoreForTests();
  });

  it("returns 400 for invalid session id format", async () => {
    const req = new Request("http://localhost/api/session/bad!/state?pid=p1");
    const res = await GET(req, { params: { id: "bad!" } });
    expect(res.status).toBe(400);
  });

  it("returns 404 when session is missing", async () => {
    const req = new Request("http://localhost/api/session/s1/state?pid=p1");
    const res = await GET(req, { params: { id: "s1" } });
    expect(res.status).toBe(404);
  });

  it("returns 400 when pid query param is missing", async () => {
    createSession({
      id: "s1",
      hostId: "host1",
      createdAt: Date.now(),
      recordStartAt: null,
      participants: {},
    });
    const req = new Request("http://localhost/api/session/s1/state");
    const res = await GET(req, { params: { id: "s1" } });
    expect(res.status).toBe(400);
  });

  it("returns 404 when participant is not in session", async () => {
    createSession({
      id: "s1",
      hostId: "host1",
      createdAt: Date.now(),
      recordStartAt: null,
      participants: {
        host1: { id: "host1", name: "Host", joinedAt: Date.now(), connected: true },
      },
    });

    const req = new Request("http://localhost/api/session/s1/state?pid=guest2");
    const res = await GET(req, { params: { id: "s1" } });
    expect(res.status).toBe(404);
  });

  it("returns ok for a valid participant in session", async () => {
    createSession({
      id: "s1",
      hostId: "host1",
      createdAt: Date.now(),
      recordStartAt: null,
      participants: {
        host1: { id: "host1", name: "Host", joinedAt: Date.now(), connected: true },
      },
    });

    const req = new Request("http://localhost/api/session/s1/state?pid=host1");
    const res = await GET(req, { params: { id: "s1" } });
    expect(res.status).toBe(200);

    const body = (await res.json()) as {
      ok: boolean;
      sessionId: string;
      participantId: string;
      hostId: string;
    };
    expect(body).toEqual({
      ok: true,
      sessionId: "s1",
      participantId: "host1",
      hostId: "host1",
    });
  });
});
