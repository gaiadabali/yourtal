// Runs apps/api's ledger-client contract spec against a live services/ledger
// (4.1.d). Run it through the test-database wrapper, which creates a fresh
// yourtal_test_* database and sets LEDGER_DATABASE_URL and DATABASE_URL:
//
//   node packages/db/scripts/with-test-db.mjs -- node scripts/ledger-contract-live.mjs
//
// Builds the ledger, starts it on a free loopback port against that database,
// waits for /readyz, runs the spec with LEDGER_CONTRACT_LIVE_URL, and stops it.
import { spawn, spawnSync } from "node:child_process";
import { mkdtempSync, openSync, readFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const secret = process.env.LEDGER_SERVICE_SECRET ?? "local-only-ledger-service-secret-not-real";
if (!/yourtal_test_/.test(process.env.LEDGER_DATABASE_URL ?? "")) {
  console.error("ledger-contract-live: run me through packages/db/scripts/with-test-db.mjs");
  process.exit(2);
}

const scratch = mkdtempSync(path.join(tmpdir(), "ledger-live-"));
const binary = path.join(scratch, process.platform === "win32" ? "ledger.exe" : "ledger");
const logPath = path.join(scratch, "ledger.log");
const build = spawnSync("go", ["build", "-o", binary, "./cmd/ledger"], { cwd: path.join(root, "services/ledger"), stdio: "inherit" });
if (build.status !== 0) process.exit(build.status ?? 1);

const port = await new Promise((resolve) => {
  const probe = createServer().listen(0, "127.0.0.1", () => {
    const { port: free } = probe.address();
    probe.close(() => resolve(free));
  });
});
const url = `http://127.0.0.1:${port}`;
const ledger = spawn(binary, [], {
  env: { ...process.env, LEDGER_ADDR: `127.0.0.1:${port}`, LEDGER_SERVICE_SECRET: secret },
  stdio: ["ignore", openSync(logPath, "w"), "inherit"],
});

let ready = false;
for (let attempt = 0; attempt < 100 && !ready; attempt++) {
  ready = await fetch(`${url}/readyz`).then((r) => r.ok, () => false);
  if (!ready) await new Promise((r) => setTimeout(r, 100));
}
if (!ready) {
  ledger.kill();
  console.error("ledger-contract-live: the ledger never became ready");
  process.exit(1);
}

const spec = spawnSync(
  "pnpm",
  ["--filter", "@yourtal/api", "exec", "vitest", "run", "src/shared/ledger-client/ledger-client.contract.spec.ts"],
  { cwd: root, stdio: "inherit", shell: true, env: { ...process.env, LEDGER_CONTRACT_LIVE_URL: url, LEDGER_SERVICE_SECRET: secret } },
);
ledger.kill();
if (spec.status !== 0) {
  // The ledger's own account of what it refused or failed on.
  for (const line of readFileSync(logPath, "utf8").split("\n")) {
    if (line.includes('"level":"ERROR"')) console.error(line);
  }
}
process.exit(spec.status ?? 1);
