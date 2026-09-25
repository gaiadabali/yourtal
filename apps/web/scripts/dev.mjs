#!/usr/bin/env node
// `next dev` on this checkout's WEB_PORT, loopback only, so slot worktrees run side by side.
// Next reads apps/web/.env, not the root one, hence the explicit load.
import { spawn } from "node:child_process";
import { createRequire } from "node:module";

try {
  process.loadEnvFile(new URL("../../../.env", import.meta.url));
} catch (error) {
  if (error?.code !== "ENOENT") throw error;
}

const port = process.env.WEB_PORT ?? "3000";
const next = createRequire(import.meta.url).resolve("next/dist/bin/next");
const child = spawn(
  process.execPath,
  [next, "dev", "-H", "127.0.0.1", "-p", port, ...process.argv.slice(2)],
  {
    stdio: "inherit",
  },
);
child.on("exit", (code, signal) =>
  signal ? process.kill(process.pid, signal) : process.exit(code ?? 1),
);
