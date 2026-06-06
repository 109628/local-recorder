import { Session, Participant, ServerEvent } from "./types";

// In-memory session store + SSE subscriber registry.
// Single-process dev store. Survives across requests via globalThis pin (Next dev HMR safe).

type Subscriber = (e: ServerEvent) => void;

interface StoreState {
  sessions: Map<string, Session>;
  subscribers: Map<string, Set<Subscriber>>; // sessionId -> listeners
}

const g = globalThis as unknown as { __recordeStore?: StoreState };

const state: StoreState =
  g.__recordeStore ??
  (g.__recordeStore = { sessions: new Map(), subscribers: new Map() });

export function createSession(s: Session): void {
  state.sessions.set(s.id, s);
}

export function getSession(id: string): Session | undefined {
  return state.sessions.get(id);
}

export function addParticipant(sessionId: string, p: Participant): Session | undefined {
  const s = state.sessions.get(sessionId);
  if (!s) return undefined;
  s.participants[p.id] = p;
  broadcastPresence(sessionId);
  return s;
}

export function setConnected(sessionId: string, participantId: string, connected: boolean): void {
  const s = state.sessions.get(sessionId);
  const p = s?.participants[participantId];
  if (p) {
    p.connected = connected;
    broadcastPresence(sessionId);
  }
}

export function startRecording(sessionId: string): number | undefined {
  const s = state.sessions.get(sessionId);
  if (!s) return undefined;
  // Small lead so all clients receive event before the wall-clock start.
  const recordStartAt = Date.now() + 1500;
  s.recordStartAt = recordStartAt;
  emit(sessionId, { type: "recordStart", recordStartAt });
  return recordStartAt;
}

export function stopRecording(sessionId: string): void {
  emit(sessionId, { type: "recordStop", stoppedAt: Date.now() });
}

export function subscribe(sessionId: string, fn: Subscriber): () => void {
  let set = state.subscribers.get(sessionId);
  if (!set) {
    set = new Set();
    state.subscribers.set(sessionId, set);
  }
  set.add(fn);
  return () => set!.delete(fn);
}

// Test helper to keep unit tests isolated from global in-memory state.
export function __resetStoreForTests(): void {
  state.sessions.clear();
  state.subscribers.clear();
}

function emit(sessionId: string, e: ServerEvent): void {
  state.subscribers.get(sessionId)?.forEach((fn) => fn(e));
}

function broadcastPresence(sessionId: string): void {
  const s = state.sessions.get(sessionId);
  if (!s) return;
  emit(sessionId, { type: "presence", participants: Object.values(s.participants) });
}
