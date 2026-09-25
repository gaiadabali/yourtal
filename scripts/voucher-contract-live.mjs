// Runs apps/api's voucher-client contract spec against a live
// services/voucher (4.5). Run it through the test-database wrapper, which
// creates a fresh yourtal_test_* database and sets VOUCHER_DATABASE_URL and
// DATABASE_URL:
//
//   node packages/db/scripts/with-test-db.mjs -- node scripts/voucher-contract-live.mjs
//
// Builds the voucher service, generates a throwaway keyring (it refuses to
// boot without one — services/voucher/internal/keyring's own rule about not
// loading keys from inside a git tree means these have to live in the OS
// temp dir, same as the binary itself), starts it on a free loopback port,
// waits for /healthz, runs the spec with VOUCHER_CONTRACT_LIVE_URL, and
// stops it. Mirrors scripts/ledger-contract-live.mjs.
import { randomBytes } from "node:crypto";
import { spawn, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, openSync, readFileSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const secret = process.env.VOUCHER_SERVICE_SECRET ?? "local-only-voucher-service-secret-not-real";
if (!/yourtal_test_/.test(process.env.VOUCHER_DATABASE_URL ?? "")) {
  console.error("voucher-contract-live: run me through packages/db/scripts/with-test-db.mjs");
  process.exit(2);
}

const scratch = mkdtempSync(path.join(tmpdir(), "voucher-live-"));
const binary = path.join(scratch, process.platform === "win32" ? "voucher.exe" : "voucher");
const logPath = path.join(scratch, "voucher.log");
const build = spawnSync("go", ["build", "-o", binary, "./cmd/voucher"], {
  cwd: path.join(root, "services/voucher"),
  stdio: "inherit",
});
if (build.status !== 0) process.exit(build.status ?? 1);

// A throwaway keyring: one 32-byte key per purpose the service requires at
// boot (services/voucher/cmd/voucher/main.go's loadKeys). Outside the repo
// (the OS temp dir), so keyring.FromDirectory's git-tree check does not
// refuse it.
const keyDir = path.join(scratch, "keys");
mkdirSync(keyDir);
for (const purpose of ["voucher_code", "merchant_hmac", "voucher_qr"]) {
  writeFileSync(path.join(keyDir, `${purpose}.v1.key`), randomBytes(32).toString("hex"));
}

const port = await new Promise((resolve) => {
  const probe = createServer().listen(0, "127.0.0.1", () => {
    const { port: free } = probe.address();
    probe.close(() => resolve(free));
  });
});
const url = `http://127.0.0.1:${port}`;
const voucher = spawn(binary, [], {
  env: {
    ...process.env,
    VOUCHER_ADDR: `127.0.0.1:${port}`,
    VOUCHER_SERVICE_SECRET: secret,
    VOUCHER_KEY_DIR: keyDir,
  },
  stdio: ["ignore", openSync(logPath, "w"), "inherit"],
});

let ready = false;
for (let attempt = 0; attempt < 100 && !ready; attempt++) {
  ready = await fetch(`${url}/healthz`).then(
    (r) => r.ok,
    () => false,
  );
  if (!ready) await new Promise((r) => setTimeout(r, 100));
}
if (!ready) {
  voucher.kill();
  console.error("voucher-contract-live: the voucher service never became ready");
  process.exit(1);
}

const spec = spawnSync(
  "pnpm",
  [
    "--filter",
    "@yourtal/api",
    "exec",
    "vitest",
    "run",
    "src/shared/voucher-client/voucher-client.contract.spec.ts",
  ],
  {
    cwd: root,
    stdio: "inherit",
    shell: true,
    env: { ...process.env, VOUCHER_CONTRACT_LIVE_URL: url, VOUCHER_SERVICE_SECRET: secret },
  },
);
voucher.kill();
if (spec.status !== 0) {
  // The voucher service's own account of what it refused or failed on.
  for (const line of readFileSync(logPath, "utf8").split("\n")) {
    if (line.includes('"level":"ERROR"')) console.error(line);
  }
}
process.exit(spec.status ?? 1);
