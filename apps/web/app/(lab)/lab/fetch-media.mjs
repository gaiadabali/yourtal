#!/usr/bin/env node
// Downloads the prototype clips into apps/web/public/lab-media/ (gitignored) and
// writes CREDITS.txt, a poster per clip (when ffmpeg is on PATH) and caption files.
// Run: node "apps/web/app/(lab)/lab/fetch-media.mjs"
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { CLIPS } from "./lab-clips.mjs";

const OUT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../public/lab-media");
const LICENCE =
  "Pexels License (free to use, no attribution required): https://www.pexels.com/license/";

mkdirSync(OUT, { recursive: true });
const hasFfmpeg = spawnSync("ffmpeg", ["-version"], { stdio: "ignore" }).status === 0;

for (const clip of CLIPS) {
  const video = path.join(OUT, `${clip.slug}.mp4`);
  if (!existsSync(video)) {
    const response = await fetch(clip.url);
    if (!response.ok) throw new Error(`${clip.url}: HTTP ${response.status}`);
    await writeFile(video, Buffer.from(await response.arrayBuffer()));
    console.log(`fetched ${clip.slug}`);
  }
  const poster = path.join(OUT, `${clip.slug}.jpg`);
  if (hasFfmpeg && !existsSync(poster)) {
    spawnSync("ffmpeg", [
      "-v",
      "error",
      "-ss",
      String(clip.posterAt ?? 0.5),
      "-i",
      video,
      "-frames:v",
      "1",
      "-q:v",
      "4",
      poster,
    ]);
  }
  const cues = clip.captions
    .map((text, i) => `${stamp(i * 3)} --> ${stamp(i * 3 + 3)}\n${text}`)
    .join("\n\n");
  writeFileSync(path.join(OUT, `${clip.slug}.vtt`), `WEBVTT\n\n${cues}\n`);
}

writeFileSync(
  path.join(OUT, "CREDITS.txt"),
  CLIPS.map((c) => `${c.slug}.mp4\n  ${c.page}\n  ${c.url}\n  ${LICENCE}`).join("\n\n") + "\n",
);
console.log(`${CLIPS.length} clips in ${OUT}${hasFfmpeg ? "" : " (no ffmpeg: posters skipped)"}`);

function stamp(seconds) {
  return `00:${String(seconds).padStart(2, "0")}.000`;
}
