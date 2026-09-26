// Runs apps/api's voucher-client contract spec against a live
// services/voucher (4.5), with a live services/ledger behind it so the
// capture outbox drains for real (4.6.f.2). Run it through the test-database
// wrapper, which creates a fresh yourtal_test_* database and sets
// VOUCHER_DATABASE_URL, LEDGER_DATABASE_URL and DATABASE_URL:
//
//   node packages/db/scripts/with-test-db.mjs -- node scripts/voucher-contract-live.mjs
//
// Builds both services, generates a throwaway keyring in the OS temp dir (the
// keyring refuses keys inside a git tree), starts them on free loopback
// ports, runs the spec, then checks every capture reached ledger.capture
// and every voucher's chain head is anchored in the ledger (4.6.h).
import { randomBytes } from "node:crypto";
import { spawn, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, openSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const pg = createRequire(path.join(root, "packages/db/package.json"))("pg");
const secret = process.env.VOUCHER_SERVICE_SECRET ?? "local-only-voucher-service-secret-not-real";
const ledgerSecret =
  process.env.LEDGER_SERVICE_SECRET ?? "local-only-ledger-service-secret-not-real";
if (!/yourtal_test_/.test(process.env.VOUCHER_DATABASE_URL ?? "")) {
  console.error("voucher-contract-live: run me through packages/db/scripts/with-test-db.mjs");
  process.exit(2);
}

const scratch = mkdtempSync(path.join(tmpdir(), "voucher-live-"));
const exe = (name) => path.join(scratch, process.platform === "win32" ? `${name}.exe` : name);
for (const name of ["voucher", "ledger"]) {
  const build = spawnSync("go", ["build", "-o", exe(name), `./cmd/${name}`], {
    cwd: path.join(root, `services/${name}`),
    stdio: "inherit",
  });
  if (build.status !== 0) process.exit(build.status ?? 1);
}

// One 32-byte key per purpose the voucher service requires at boot.
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

const children = [];
async function start(name, env, readyPath) {
  const port = await freePort();
  const url = `http://127.0.0.1:${port}`;
  const logPath = path.join(scratch, `${name}.log`);
  const child = spawn(exe(name), [], {
    env: { ...process.env, ...env, [`${name.toUpperCase()}_ADDR`]: `127.0.0.1:${port}` },
    stdio: ["ignore", openSync(logPath, "w"), "inherit"],
  });
  children.push({ child, logPath });
  for (let attempt = 0; attempt < 100; attempt++) {
    const ready = await fetch(`${url}${readyPath}`).then(
      (r) => r.ok,
      () => false,
    );
    if (ready) return url;
    await new Promise((r) => setTimeout(r, 100));
  }
  finish(1, `the ${name} service never became ready`);
}

function finish(status, message) {
  for (const { child } of children) child.kill();
  if (status !== 0) {
    if (message) console.error(`voucher-contract-live: ${message}`);
    for (const { logPath } of children) {
      for (const line of readFileSync(logPath, "utf8").split("\n")) {
        if (line.includes('"level":"ERROR"')) console.error(line);
      }
    }
  }
  process.exit(status);
}

const ledgerUrl = await start(
  "ledger",
  {
    LEDGER_SERVICE_SECRET: ledgerSecret,
    REWARD_ATTESTATION_SECRET: "local-only-reward-attestation-secret-not-real",
  },
  "/readyz",
);
const url = await start(
  "voucher",
  {
    VOUCHER_SERVICE_SECRET: secret,
    VOUCHER_KEY_DIR: keyDir,
    LEDGER_BASE_URL: ledgerUrl,
    LEDGER_SERVICE_SECRET: ledgerSecret,
  },
  "/healthz",
);

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
if (spec.status !== 0) finish(spec.status ?? 1);

// 4.6.f.2 end to end: every capture the spec made is posted to the ledger,
// once, with the same terms, and marked posted in the outbox.
const db = new pg.Client({ connectionString: process.env.DATABASE_OWNER_URL });
await db.connect();
let rows = [];
for (let attempt = 0; attempt < 40; attempt++) {
  ({ rows } = await db.query(`
    SELECT o.capture_id, o.posted_at IS NOT NULL AS posted,
           c.capture_id IS NOT NULL AND c.amount_minor = o.amount_minor AND c.currency = o.currency
             AND c.region = o.region AND c.merchant_id = o.merchant_id::text AS matches
      FROM voucher.capture_outbox o LEFT JOIN ledger.capture c ON c.capture_id = o.capture_id::text`));
  if (rows.length > 0 && rows.every((r) => r.posted && r.matches)) break;
  await new Promise((r) => setTimeout(r, 500));
}
if (rows.length === 0) finish(1, "the spec made no capture, so the outbox drain was not exercised");
const stuck = rows.filter((r) => !(r.posted && r.matches));
if (stuck.length > 0) finish(1, `captures not posted to the ledger: ${JSON.stringify(stuck)}`);
console.log(`voucher-contract-live: ${rows.length} capture(s) posted to the ledger`);

// 4.6.h end to end: every voucher's latest chain head is anchored in the ledger.
let heads = [];
for (let attempt = 0; attempt < 40; attempt++) {
  ({ rows: heads } = await db.query(`
    SELECT v.id, a.head_hash = e.hash AND a.region = v.region AS anchored
      FROM voucher.vouchers v
      JOIN LATERAL (SELECT seq, hash FROM voucher.event WHERE voucher_id = v.id ORDER BY seq DESC LIMIT 1) e ON true
      LEFT JOIN ledger.voucher_head_anchor a ON a.voucher_id = v.id AND a.seq = e.seq`));
  if (heads.length > 0 && heads.every((h) => h.anchored)) break;
  await new Promise((r) => setTimeout(r, 500));
}
await db.end();
const unanchored = heads.filter((h) => !h.anchored);
if (heads.length === 0) finish(1, "no voucher has a chain, so anchoring was not exercised");
if (unanchored.length > 0)
  finish(1, `chain heads not anchored: ${JSON.stringify(unanchored.slice(0, 5))}`);
console.log(`voucher-contract-live: ${heads.length} chain head(s) anchored in the ledger`);
finish(0);
