import type { ParticipantChunks } from "@/lib/types";

const CELL_W = 640;
const CELL_H = 360;
const FPS = 30;

export function buildXstackLayout(count: number): string {
  const cols = Math.ceil(Math.sqrt(count));
  const cells: string[] = [];
  for (let i = 0; i < count; i++) {
    const row = Math.floor(i / cols);
    const col = i % cols;
    const xExpr = col === 0 ? "0" : col === 1 ? "w0" : `${col}*w0`;
    const yExpr = row === 0 ? "0" : row === 1 ? "h0" : `${row}*h0`;
    cells.push(`${xExpr}_${yExpr}`);
  }
  return cells.join("|");
}

async function concatParticipant(ffmpeg: {
  writeFile: (path: string, data: Uint8Array) => Promise<boolean>;
  exec: (args: string[]) => Promise<number>;
}, participant: ParticipantChunks, idx: number): Promise<string> {
  const listLines: string[] = [];

  for (const chunk of participant.chunks) {
    const fileName = `p${idx}_c${chunk.index}.webm`;
    const res = await fetch(chunk.url);
    if (!res.ok) {
      throw new Error(`Failed to download chunk ${chunk.objectName} (${res.status})`);
    }
    const data = new Uint8Array(await res.arrayBuffer());
    await ffmpeg.writeFile(fileName, data);
    listLines.push(`file '${fileName}'`);
  }

  const listName = `p${idx}.txt`;
  await ffmpeg.writeFile(listName, new TextEncoder().encode(listLines.join("\n")));

  const outName = `p${idx}.webm`;
  let exit = await ffmpeg.exec(["-y", "-f", "concat", "-safe", "0", "-i", listName, "-c", "copy", outName]);
  if (exit !== 0) {
    exit = await ffmpeg.exec([
      "-y",
      "-f",
      "concat",
      "-safe",
      "0",
      "-i",
      listName,
      "-c:v",
      "copy",
      "-c:a",
      "libopus",
      outName,
    ]);
  }
  if (exit !== 0) {
    throw new Error(`Failed to concat participant ${participant.participantId}`);
  }
  return outName;
}

function delayMs(base: number, participant: ParticipantChunks): number {
  return Math.max(0, participant.recordStartAt - base);
}

export async function mixSessionInBrowser(input: {
  sessionId: string;
  participants: ParticipantChunks[];
}): Promise<Blob> {
  const participants = input.participants.filter((p) => p.chunks.length > 0);
  if (participants.length === 0) {
    throw new Error("No uploaded chunks found in storage.");
  }

  const { FFmpeg } = await import("@ffmpeg/ffmpeg");
  const ffmpeg = new FFmpeg();

  const base = "/ffmpeg";
  try {
    await ffmpeg.load({
      coreURL: `${base}/ffmpeg-core.js`,
      wasmURL: `${base}/ffmpeg-core.wasm`,
    });
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    throw new Error(
      `Failed to load local ffmpeg.wasm core from ${base}. Details: ${reason}`
    );
  }

  const trackNames: string[] = [];
  for (let i = 0; i < participants.length; i++) {
    const track = await concatParticipant(ffmpeg, participants[i], i);
    trackNames.push(track);
  }

  const outName = `${input.sessionId}-mix.webm`;
  const earliestStartAt = Math.min(...participants.map((p) => p.recordStartAt));

  if (trackNames.length === 1) {
    const filter = `[0:v]scale=${CELL_W}:${CELL_H}:force_original_aspect_ratio=decrease,` +
      `pad=${CELL_W}:${CELL_H}:(ow-iw)/2:(oh-ih)/2:black,setsar=1,fps=${FPS}[vout];` +
      `[0:a]anull[aout]`;
    const exit = await ffmpeg.exec([
      "-y",
      "-i",
      trackNames[0],
      "-filter_complex",
      filter,
      "-map",
      "[vout]",
      "-map",
      "[aout]",
      "-c:v",
      "libvpx",
      "-crf",
      "33",
      "-b:v",
      "0",
      "-c:a",
      "libopus",
      "-b:a",
      "128k",
      outName,
    ]);
    if (exit !== 0) throw new Error("Failed to build single-track output.");
  } else {
    const filterParts: string[] = [];
    for (let i = 0; i < trackNames.length; i++) {
      const delay = delayMs(earliestStartAt, participants[i]);
      filterParts.push(
        `[${i}:v]setpts=PTS+${delay}/1000/TB,` +
          `scale=${CELL_W}:${CELL_H}:force_original_aspect_ratio=decrease,` +
          `pad=${CELL_W}:${CELL_H}:(ow-iw)/2:(oh-ih)/2:black,setsar=1,fps=${FPS}[v${i}]`
      );
      filterParts.push(`[${i}:a]adelay=${delay}|${delay}[a${i}]`);
    }
    const layout = buildXstackLayout(trackNames.length);
    const videoInputs = Array.from({ length: trackNames.length }, (_, i) => `[v${i}]`).join("");
    filterParts.push(`${videoInputs}xstack=inputs=${trackNames.length}:layout=${layout}[vout]`);
    const audioInputs = Array.from({ length: trackNames.length }, (_, i) => `[a${i}]`).join("");
    filterParts.push(`${audioInputs}amix=inputs=${trackNames.length}:duration=longest[aout]`);

    const args = [
      "-y",
      ...trackNames.flatMap((n) => ["-i", n]),
      "-filter_complex",
      filterParts.join(";"),
      "-map",
      "[vout]",
      "-map",
      "[aout]",
      "-c:v",
      "libvpx",
      "-crf",
      "33",
      "-b:v",
      "0",
      "-c:a",
      "libopus",
      "-b:a",
      "128k",
      outName,
    ];
    const exit = await ffmpeg.exec(args);
    if (exit !== 0) throw new Error("Failed to build mixed output.");
  }

  const out = await ffmpeg.readFile(outName);
  if (!(out instanceof Uint8Array)) {
    throw new Error("Unexpected output format from ffmpeg.wasm.");
  }
  const bytes = out;
  return new Blob([bytes], { type: "video/webm" });
}
