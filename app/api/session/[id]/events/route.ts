import { NextResponse } from "next/server";
import { getSession, setConnected, subscribe } from "@/lib/store";
import type { ServerEvent } from "@/lib/types";

// Force dynamic so Next.js never caches or pre-renders this streaming route.
export const dynamic = "force-dynamic";

export async function GET(
  req: Request,
  { params }: { params: { id: string } },
): Promise<NextResponse | Response> {
  const session = getSession(params.id);
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
    return NextResponse.json({ error: "Participant not found" }, { status: 404 });
  }

  const { readable, writable } = new TransformStream<Uint8Array, Uint8Array>();
  const writer = writable.getWriter();
  const encoder = new TextEncoder();

  function write(chunk: string): void {
    // Fire-and-forget; if the client is gone the abort signal will clean up.
    writer.write(encoder.encode(chunk)).catch(() => void 0);
  }

  function sendEvent(event: ServerEvent): void {
    write(`data: ${JSON.stringify(event)}\n\n`);
  }

  // Mark participant connected and broadcast current presence immediately.
  setConnected(params.id, pid, true);

  // Emit a snapshot of current presence so the connecting client is up to date
  // without waiting for the next store-triggered broadcast.
  const currentSession = getSession(params.id);
  if (currentSession) {
    sendEvent({
      type: "presence",
      participants: Object.values(currentSession.participants),
    });
  }

  // Subscribe to future store events for this session.
  const unsubscribe = subscribe(params.id, sendEvent);

  // Heartbeat: SSE comment every 15 s keeps proxies and load balancers alive.
  const heartbeatInterval = setInterval(() => {
    write(": ping\n\n");
  }, 15_000);

  // Cleanup on client disconnect.
  req.signal.addEventListener("abort", () => {
    clearInterval(heartbeatInterval);
    unsubscribe();
    setConnected(params.id, pid, false);
    writer.close().catch(() => void 0);
  });

  return new Response(readable, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      // Prevent Next.js edge buffering.
      "X-Accel-Buffering": "no",
    },
  });
}
