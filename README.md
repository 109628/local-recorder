# LocalRecorde

Browser-first local recorder with minimal Next.js signaling.

- Participants record in browser (`MediaRecorder`).
- Chunks upload directly to GCS via signed URLs.
- Host mixes in browser with `ffmpeg.wasm`.
- No DB/history: sessions are in-memory only; if server restarts, that session is gone.

## Architecture

```
Participant browser                 Next.js server                    GCS
┌────────────────────────────┐      ┌────────────────────────────┐    ┌────────────────────────────┐
│ MediaRecorder chunks       │      │ /api/session/* (SSE/start) │    │ bucket/session/pid/N.webm  │
│ -> ask signed upload URL   │ ---> │ /api/storage/upload-url     │    │                            │
│ -> PUT chunk to signed URL │ --------------------------------------> │ chunk objects              │
└────────────────────────────┘      └────────────────────────────┘    └────────────────────────────┘

Host browser:
- GET /api/storage/download-urls/[id] (host auth)
- download chunk URLs
- run ffmpeg.wasm
- download mixed .webm locally
```

## Run

```bash
cp .env.example .env.local
npm install
npm run dev
```

Set in `.env.local`:

- `JOIN_TOKEN_SECRET`
- `GCP_STORAGE_BUCKET` (your bucket, e.g. `poc-storage-v1`)
- `GCP_PROJECT_ID`
- `GCP_SERVICE_ACCOUNT_KEY_JSON` (full JSON string)

## Important behavior

- Session state is in memory (`lib/store.ts`) and is intentionally ephemeral.
- No server-side recordings folder, no server-side ffmpeg mixing.
- If session process dies, session coordination/auth context is lost by design.
# local-recorder
