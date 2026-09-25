import { readFileSync } from "node:fs";
import { parseEnv } from "node:util";

/**
 * The slot's PLAYWRIGHT_PORT from the root .env, plus an offset per suite.
 * Reads that one key only: loading the whole file would leak its
 * NODE_ENV=development into `next build`, which then fails to prerender.
 */
export function playwrightPort(offset = 0): number {
  let fromFile: string | undefined;
  try {
    fromFile = parseEnv(readFileSync(new URL("../../.env", import.meta.url), "utf8"))[
      "PLAYWRIGHT_PORT"
    ];
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  return Number(process.env["PLAYWRIGHT_PORT"] ?? fromFile ?? 3100) + offset;
}
