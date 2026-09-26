// Runs the burn saga end to end against a live ledger and a live voucher
// service on one test database (4.7.d). Run it through the test-database
// wrapper, which creates a fresh yourtal_test_* database and sets
// DATABASE_URL, LEDGER_DATABASE_URL and VOUCHER_DATABASE_URL:
//
//   node packages/db/scripts/with-test-db.mjs -- node scripts/checkout-live.mjs
//
// Builds both services, starts the ledger, and runs checkout.live.test.ts
// with LEDGER_MODE=live. The spec starts the voucher service itself, because
// it kills and restarts it mid-saga.
import { randomBytes } from "node:crypto";
import { spawn, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, openSync, readFileSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ledgerSecret =
  process.env.LEDGER_SERVICE_SECRET ?? "local-only-ledger-service-secret-not-real";
const voucherSecret =
  process.env.VOUCHER_SERVICE_SECRET ?? "local-only-voucher-service-secret-not-real";
const attestationSecret =
  process.env.REWARD_ATTESTATION_SECRET ?? "local-only-reward-attestation-secret-not-real";
for (const name of ["LEDGER_DATABASE_URL", "VOUCHER_DATABASE_URL"]) {
  if (!/yourtal_test_/.test(process.env[name] ?? "")) {
    console.error("checkout-live: run me through packages/db/scripts/with-test-db.mjs");
    process.exit(2);
  }
}

const scratch = mkdtempSync(path.join(tmpdir(), "checkout-live-"));
const exe = process.platform === "win32" ? ".exe" : "";
const binaries = {};
for (const service of ["ledger", "voucher"]) {
  binaries[service] = path.join(scratch, `${service}${exe}`);
  const build = spawnSync("go", ["build", "-o", binaries[service], `./cmd/${service}`], {
    cwd: path.join(root, "services", service),
    stdio: "inherit",
  });
  if (build.status !== 0) process.exit(build.status ?? 1);
}

// The voucher service's keyring must live outside a git tree (keyring.FromDirectory).
const keyDir = path.join(scratch, "keys");
mkdirSync(keyDir);
for (const purpose of ["voucher_code", "merchant_hmac", "voucher_qr"]) {
  writeFileSync(path.join(keyDir, `${purpose}.v1.key`), randomBytes(32).toString("hex"));
}

const freePort = () =>
  new Promise((resolve) => {
    const probe = createServer().listen(0, "127.0.0.1", () => {
      const { port } = probe.address();
      probe.close(() => resolve(port));
    });
  });
const ledgerPort = await freePort();
const voucherPort = await freePort();
const ledgerUrl = `http://127.0.0.1:${ledgerPort}`;
const ledgerLog = path.join(scratch, "ledger.log");
const ledger = spawn(binaries.ledger, [], {
  env: {
    ...process.env,
    LEDGER_ADDR: `127.0.0.1:${ledgerPort}`,
    LEDGER_SERVICE_SECRET: ledgerSecret,
    REWARD_ATTESTATION_SECRET: attestationSecret,
  },
  stdio: ["ignore", openSync(ledgerLog, "w"), "inherit"],
});

let ready = false;
for (let attempt = 0; attempt < 100 && !ready; attempt++) {
  ready = await fetch(`${ledgerUrl}/readyz`).then(
    (r) => r.ok,
    () => false,
  );
  if (!ready) await new Promise((r) => setTimeout(r, 100));
}
if (!ready) {
  ledger.kill();
  console.error("checkout-live: the ledger never became ready");
  process.exit(1);
}

const voucherLog = path.join(scratch, "voucher.log");
const spec = spawnSync(
  "pnpm",
  [
    "--filter",
    "@yourtal/api",
    "exec",
    "vitest",
    "run",
    "src/modules/checkout/checkout.live.test.ts",
  ],
  {
    cwd: root,
    stdio: "inherit",
    shell: true,
    env: {
      ...process.env,
      CHECKOUT_LIVE: "1",
      LEDGER_MODE: "live",
      LEDGER_BASE_URL: ledgerUrl,
      VOUCHER_BASE_URL: `http://127.0.0.1:${voucherPort}`,
      LEDGER_SERVICE_SECRET: ledgerSecret,
      VOUCHER_SERVICE_SECRET: voucherSecret,
      REWARD_ATTESTATION_SECRET: attestationSecret,
      CHECKOUT_LIVE_VOUCHER_BIN: binaries.voucher,
      CHECKOUT_LIVE_VOUCHER_LOG: voucherLog,
      VOUCHER_ADDR: `127.0.0.1:${voucherPort}`,
      VOUCHER_KEY_DIR: keyDir,
    },
  },
);
ledger.kill();
if (spec.status !== 0) {
  // Each service's own account of what it refused or failed on.
  for (const log of [ledgerLog, voucherLog]) {
    for (const line of readFileSync(log, { encoding: "utf8", flag: "a+" }).split("\n")) {
      if (line.includes('"level":"ERROR"')) console.error(line);
    }
  }
}
process.exit(spec.status ?? 1);
