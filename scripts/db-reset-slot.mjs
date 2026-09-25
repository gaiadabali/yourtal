#!/usr/bin/env node
// Drop, create, migrate and seed THIS worktree's database only.
// Refuses anything but a slot database, so it can never touch the shared `yourtal`.
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

try {
  process.loadEnvFile(new URL("../.env", import.meta.url));
} catch (error) {
  if (error?.code !== "ENOENT") throw error;
}

const url = process.env.DATABASE_OWNER_URL ?? "";
const name = url.match(/\/([^/?]+)(\?|$)/)?.[1];
if (!name || !/^yourtal_s[1-9]$/.test(name)) {
  console.error(
    `Refusing: DATABASE_OWNER_URL names ${JSON.stringify(name ?? "")}, not a slot database (yourtal_s1..s3).`,
  );
  process.exit(1);
}

const script = fileURLToPath(new URL("../packages/db/scripts/test-db.mjs", import.meta.url));
const result = spawnSync(process.execPath, [script, "create", name], {
  stdio: "inherit",
});
process.exit(result.status ?? 1);
