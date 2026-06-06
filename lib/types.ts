// Shared domain types. Owned by scaffold — agents import, do not redefine.

export interface Participant {
  id: string;
  name: string;
  joinedAt: number; // Unix ms
  connected: boolean;
}

export interface Session {
  id: string;
  hostId: string;
  createdAt: number; // Unix ms
  recordStartAt: number | null; // Unix ms broadcast to align tracks; null until host starts
  participants: Record<string, Participant>;
}

// SSE event envelope pushed server -> client on /api/session/[id]/events
export type ServerEvent =
  | { type: "presence"; participants: Participant[] }
  | { type: "recordStart"; recordStartAt: number }
  | { type: "recordStop"; stoppedAt: number };

// POST /api/session  -> create
export interface CreateSessionResponse {
  sessionId: string;
  hostId: string;
  token: string; // JWT join token for host
}

// POST /api/session/[id]/join
export interface JoinSessionRequest {
  name: string;
}
export interface JoinSessionResponse {
  participantId: string;
  token: string; // JWT join token
  session: Session;
}

// Chunk upload metadata. One blob slice per MediaRecorder timeslice.
export interface ChunkMeta {
  sessionId: string;
  participantId: string;
  chunkIndex: number;
  recordStartAt: number; // ms, for alignment at mix time
  mimeType: string;
}

export interface MixResult {
  sessionId: string;
  outputPath: string;
  tracks: { participantId: string; chunks: number }[];
}

export interface ChunkDownload {
  index: number;
  objectName: string;
  url: string;
}

export interface ParticipantChunks {
  participantId: string;
  recordStartAt: number;
  chunks: ChunkDownload[];
}
