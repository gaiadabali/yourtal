import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdirSync, mkdtempSync, openSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";

/**
 * TASKS.md 8.3.d/8.3.f/8.4.b: the "build and spawn a real ledger and a real
 * voucher service for one `*.live.test.ts` file" setup, extracted rather
 * than copied a third time (it first appeared duplicated between
 * `checkout.live.test.ts` and `partner-checkout-redeem.live.test.ts`).
 * Lives under `modules/devices` (Area C's own path) since both current
 * callers are Area C's own live tests; not a `scripts/checkout-live.mjs`
 * change (Area A's path).
 *
 * Sets `process.env.LEDGER_MODE`/`LEDGER_BASE_URL`/`VOUCHER_BASE_URL`/the
 * three secrets BEFORE returning, so a caller can boot `AppModule` right
 * after `await startLiveServices()` and get a real `HttpVoucherClient`/
 * `HttpLedgerClient`, not the fake.
 */
export interface LiveServices {
  readonly ledgerUrl: string;
  readonly voucherUrl: string;
  readonly ledgerSecret: string;
  readonly voucherSecret: string;
  readonly attestationSecret: string;
  stop(): Promise<void>;
}

async function healthy(url: string): Promise<boolean> {
  return fetch(`${url}/healthz`).then(
    (r) => r.ok,
    () => false,
  );
}

const freePort = (): Promise<number> =>
  new Promise((resolve) => {
    const probe = createServer().listen(0, "127.0.0.1", () => {
      const address = probe.address();
      const port = typeof address === "object" && address !== null ? address.port : 0;
      probe.close(() => resolve(port));
    });
  });

/** `root` is the repo root (two levels up from `apps/api`). */
export async function startLiveServices(root: string): Promise<LiveServices> {
  for (const name of ["LEDGER_DATABASE_URL", "VOUCHER_DATABASE_URL"]) {
    if (!/yourtal_test_/.test(process.env[name] ?? "")) {
      throw new Error(
        "startLiveServices: run this suite through packages/db/scripts/with-test-db.mjs",
      );
    }
  }
  const scratch = mkdtempSync(path.join(tmpdir(), "live-services-"));
  const exe = process.platform === "win32" ? ".exe" : "";
  const ledgerSecret =
    process.env["LEDGER_SERVICE_SECRET"] ?? "local-only-ledger-service-secret-not-real";
  const voucherSecret =
    process.env["VOUCHER_SERVICE_SECRET"] ?? "local-only-voucher-service-secret-not-real";
  const attestationSecret =
    process.env["REWARD_ATTESTATION_SECRET"] ?? "local-only-reward-attestation-secret-not-real";

  const binaries: Record<string, string> = {};
  for (const service of ["ledger", "voucher"]) {
    binaries[service] = path.join(scratch, `${service}${exe}`);
    const build = spawnSync("go", ["build", "-o", binaries[service], `./cmd/${service}`], {
      cwd: path.join(root, "services", service),
      stdio: "inherit",
    });
    if (build.status !== 0) throw new Error(`building ${service} failed`);
  }
  const keyDir = path.join(scratch, "keys");
  mkdirSync(keyDir);
  for (const purpose of ["voucher_code", "merchant_hmac", "voucher_qr"]) {
    writeFileSync(path.join(keyDir, `${purpose}.v1.key`), randomBytes(32).toString("hex"));
  }

  const ledgerPort = await freePort();
  const voucherPort = await freePort();
  const ledgerUrl = `http://127.0.0.1:${String(ledgerPort)}`;
  const voucherUrl = `http://127.0.0.1:${String(voucherPort)}`;

  const ledger: ChildProcess = spawn(binaries["ledger"]!, [], {
    env: {
      ...process.env,
      LEDGER_ADDR: `127.0.0.1:${String(ledgerPort)}`,
      LEDGER_SERVICE_SECRET: ledgerSecret,
      REWARD_ATTESTATION_SECRET: attestationSecret,
    },
    stdio: ["ignore", openSync(path.join(scratch, "ledger.log"), "w"), "inherit"],
  });
  const voucher: ChildProcess = spawn(binaries["voucher"]!, [], {
    env: {
      ...process.env,
      VOUCHER_ADDR: `127.0.0.1:${String(voucherPort)}`,
      VOUCHER_SERVICE_SECRET: voucherSecret,
      VOUCHER_KEY_DIR: keyDir,
      LEDGER_BASE_URL: ledgerUrl,
      LEDGER_SERVICE_SECRET: ledgerSecret,
    },
    stdio: ["ignore", openSync(path.join(scratch, "voucher.log"), "w"), "inherit"],
  });
  for (const url of [ledgerUrl, voucherUrl]) {
    let ready = false;
    for (let attempt = 0; attempt < 100 && !ready; attempt++) {
      ready = await healthy(url);
      if (!ready) await new Promise((resolve) => setTimeout(resolve, 100));
    }
    if (!ready) throw new Error(`${url} never became ready`);
  }

  process.env["LEDGER_MODE"] = "live";
  process.env["LEDGER_BASE_URL"] = ledgerUrl;
  process.env["VOUCHER_BASE_URL"] = voucherUrl;
  process.env["LEDGER_SERVICE_SECRET"] = ledgerSecret;
  process.env["VOUCHER_SERVICE_SECRET"] = voucherSecret;
  process.env["REWARD_ATTESTATION_SECRET"] = attestationSecret;

  return {
    ledgerUrl,
    voucherUrl,
    ledgerSecret,
    voucherSecret,
    attestationSecret,
    async stop() {
      for (const child of [voucher, ledger]) {
        const exited = new Promise((resolve) => child.once("exit", resolve));
        child.kill("SIGKILL");
        await exited;
      }
    },
  };
}
