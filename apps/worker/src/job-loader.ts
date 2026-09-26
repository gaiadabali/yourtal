import { readdirSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import type { WorkerJob } from "./job";

/**
 * Scans `dir` for `*.ts` (or built `*.js`) files, excluding `*.test.*`, and dynamically
 * imports each, collecting the ones that export `job`. 1.3.c/1.3.e
 * (TASKS.md): this is the ENTIRE registration mechanism — there is no other
 * file anywhere that lists job names, so dropping a new file in
 * `src/jobs/` is picked up on the next boot with no other edit.
 *
 * A file that exports something named `job` which does NOT have the
 * `WorkerJob` shape throws, rather than being silently skipped — a typo'd
 * job (e.g. a `queue` field that got renamed) should fail the boot loudly,
 * not vanish from the worker with no trace.
 */
export interface LoadedJob {
  readonly file: string;
  readonly job: WorkerJob;
}

export async function loadJobs(dir: string): Promise<LoadedJob[]> {
  const files = readdirSync(dir, { withFileTypes: true })
    .filter(
      // .ts under src/ in dev, .js under dist/ in the built artifact (2.1.b).
      (entry) =>
        entry.isFile() && /\.(ts|js)$/.test(entry.name) && !/\.(test|d)\.[tj]s$/.test(entry.name),
    )
    .map((entry) => entry.name)
    .sort();

  const loaded: LoadedJob[] = [];
  for (const file of files) {
    const moduleUrl = pathToFileURL(path.join(dir, file)).href;
    // A computed specifier, not a literal — this is the whole point: the set
    // of job files is discovered at runtime, not enumerated in source.
    const imported: unknown = await import(moduleUrl);
    const job = readJobExport(imported, file);
    if (job !== undefined) loaded.push({ file, job });
  }
  return loaded;
}

function readJobExport(module: unknown, file: string): WorkerJob | undefined {
  if (!isRecord(module) || !("job" in module)) return undefined;
  const candidate: unknown = module.job;
  if (!isWorkerJob(candidate)) {
    throw new Error(
      `apps/worker/src/jobs/${file} exports "job" but it is not a valid WorkerJob — ` +
        `it needs a non-empty string "queue" and a "handle" function (see job.ts).`,
    );
  }
  return candidate;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/** A structural check, not a cast — no file here is trusted just because it compiled once. */
function isWorkerJob(value: unknown): value is WorkerJob {
  return (
    isRecord(value) &&
    typeof value.queue === "string" &&
    value.queue.length > 0 &&
    typeof value.handle === "function"
  );
}
