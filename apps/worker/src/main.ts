import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadWorkerConfig } from "./config";
import { startWorker } from "./worker";
import type { RunningWorker } from "./worker";

/**
 * `apps/worker` — a pg-boss runner that auto-loads every job under
 * `src/jobs/*.ts` (1.3.c). Runs on the host, not in docker-compose, because
 * a future media-transcoding job needs `ffmpeg` on PATH (see
 * `infra/HELIOS.md`), and containerising just this one process while
 * everything else in dev runs on the host would be the opposite of the
 * isolation `infra/PORTS.md` argues for elsewhere.
 *
 * Same bootstrap shape as `apps/api/src/main.ts`: an async `bootstrap()`,
 * called once, whose rejection is the one legitimate direct `console.error`
 * in this app (no logger exists before config has loaded).
 */
const jobsDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "jobs");

async function bootstrap(): Promise<void> {
  const config = loadWorkerConfig();
  const worker = await startWorker({ databaseUrl: config.databaseUrl, jobsDir });
  installShutdownHandlers(worker);
}

function installShutdownHandlers(worker: RunningWorker): void {
  let stopping = false;
  const shutdown = (signal: NodeJS.Signals): void => {
    if (stopping) return;
    stopping = true;
    console.log(`[worker] ${signal} received, finishing in-flight jobs and stopping`);
    worker
      .stop()
      .then(() => {
        process.exit(0);
      })
      .catch((error: unknown) => {
        console.error(error);
        process.exit(1);
      });
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

bootstrap().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
