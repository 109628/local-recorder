import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const srcDir = path.join(root, "node_modules", "@ffmpeg", "core", "dist", "umd");
const outDir = path.join(root, "public", "ffmpeg");

const files = ["ffmpeg-core.js", "ffmpeg-core.wasm"];

if (!fs.existsSync(srcDir)) {
  console.error(`[prepare:ffmpeg] Missing source dir: ${srcDir}`);
  process.exit(1);
}

fs.mkdirSync(outDir, { recursive: true });

for (const file of files) {
  const src = path.join(srcDir, file);
  const dest = path.join(outDir, file);
  if (!fs.existsSync(src)) {
    console.error(`[prepare:ffmpeg] Missing source file: ${src}`);
    process.exit(1);
  }
  fs.copyFileSync(src, dest);
}

console.log("[prepare:ffmpeg] Copied ffmpeg core assets to public/ffmpeg");
