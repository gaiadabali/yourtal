#!/usr/bin/env node
// Records the scripted prototype run for each variant at 390×844 and saves an MP4
// per variant to docs/audit/2026-09-25/lab/. Needs a YOURTAL_LAB=1 server and ffmpeg.
// Run: node "apps/web/app/(lab)/lab/record-prototypes.mjs" http://127.0.0.1:26320
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";

const base = process.argv[2] ?? "http://127.0.0.1:3000";
const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../../..");
const OUT = path.join(REPO, "docs/audit/2026-09-25/lab");
const SIZE = { width: 390, height: 844 };

async function run(page, variant) {
  const feed = page.getByTestId("feed");
  const swipe = async () => {
    await feed.evaluate((el) => el.scrollBy({ top: el.clientHeight, behavior: "smooth" }));
    await page.waitForTimeout(1300);
  };
  await page.goto(`${base}/lab/${variant}`);
  await page.waitForTimeout(1500);
  await swipe(); // a Quick clip: watch it to the end and it earns in place
  await page.getByText("Earned").first().waitFor({ timeout: 20_000 });
  await page.waitForTimeout(1500);
  await swipe();
  await swipe(); // a campaign
  await page.locator('[data-index="3"]').getByRole("button", { name: "Watch & earn" }).click();
  const question = page.getByRole("dialog");
  await question.waitFor({ timeout: 20_000 });
  await page.waitForTimeout(1500);
  await question.getByRole("button", { name: "Tuesday" }).click();
  await question.waitFor({ state: "detached" });
  await page.getByRole("button", { name: "Back to the feed" }).waitFor({ timeout: 30_000 });
  await page.waitForTimeout(2500); // the earn moment
  await page.getByRole("button", { name: "Store" }).click();
  await page.waitForTimeout(1500);
  await page.getByRole("button", { name: /Any coffee/ }).click();
  await page.waitForTimeout(1200);
  await page.getByRole("button", { name: /Redeem for/ }).click();
  await page.waitForTimeout(1000);
  await page.getByRole("button", { name: "Wallet" }).click();
  await page.waitForTimeout(2500);
}

mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch({ channel: "chrome" });
for (const variant of ["after-dark", "daylight"]) {
  const dir = mkdtempSync(path.join(tmpdir(), "yourtal-rec-"));
  const context = await browser.newContext({
    viewport: SIZE,
    recordVideo: { dir, size: SIZE },
  });
  const page = await context.newPage();
  await run(page, variant);
  await context.close();
  const webm = path.join(
    dir,
    readdirSync(dir).find((f) => f.endsWith(".webm")),
  );
  const mp4 = path.join(OUT, `${variant}.mp4`);
  const encoded = spawnSync("ffmpeg", [
    "-v",
    "error",
    "-y",
    "-i",
    webm,
    "-c:v",
    "libx264",
    "-pix_fmt",
    "yuv420p",
    "-crf",
    "26",
    "-movflags",
    "+faststart",
    mp4,
  ]);
  if (encoded.status !== 0) throw new Error(`ffmpeg failed for ${variant}`);
  rmSync(dir, { recursive: true, force: true });
  console.log(`saved ${path.relative(REPO, mp4)}`);
}
await browser.close();
