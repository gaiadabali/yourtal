import type pg from "pg";
import { runDemoCampaignFunding } from "../demo-campaign-funding";
import { alignDemoCampaignTerms } from "../demo-campaign-terms";
import { backfillDemoTags } from "../demo-tags";
import type { StagingLedgerConfig, StagingVoucherConfig } from "../staging";
import { DEMO_PEOPLE, resetDemoAccounts } from "./accounts";
import { forgetSessions } from "./api-client";
import type { DemoLogin } from "./accounts";
import { ensureDemoWorld } from "./world";
import type { DemoWorldCounts } from "./world";

export interface DemoResetConfig {
  readonly ledger: StagingLedgerConfig;
  readonly voucher: StagingVoucherConfig;
  readonly password: string;
  /** The web origin guardian links point at, e.g. https://yourtal.gaiada.com. */
  readonly siteUrl: string;
}

export interface DemoResetResult {
  readonly world: DemoWorldCounts;
  readonly funded: number;
  readonly fundingFailures: readonly string[];
  readonly logins: readonly DemoLogin[];
}

/** Human-readable role for the review guide, from the email's local part. */
function roleOf(email: string): string {
  return email.split("@")[0]?.split(".")[0] ?? "viewer";
}

/**
 * `pnpm demo:reset` and the staff button (13.1.a): the world is made whole,
 * funded through the ledger's own purchase route, and every demo login is
 * retired and registered again. Refuses to run in production (red line 11).
 */
export async function resetDemoWorld(
  pool: pg.Pool,
  config: DemoResetConfig,
  log: (message: string) => void,
): Promise<DemoResetResult> {
  if (process.env["APP_ENV"] === "production") {
    throw new Error("demo:reset never runs in production");
  }
  const world = await ensureDemoWorld(pool, config.ledger, config.voucher, log);
  const funding = await runDemoCampaignFunding(pool, config.ledger, log);
  await alignDemoCampaignTerms(pool, log);
  await backfillDemoTags(pool);

  const logins = await resetDemoAccounts(pool, config.ledger, config, log);
  forgetSessions();
  const staff = new Set(DEMO_PEOPLE.filter((p) => p.staffRole !== undefined).map((p) => p.email));
  for (const login of logins) {
    await pool.query(
      `INSERT INTO platform.demo_login (email, user_id, region, role, is_staff, guardian_link, reset_at)
       VALUES ($1, $2, $3, $4, $5, $6, now())
       ON CONFLICT (email) DO UPDATE SET user_id = EXCLUDED.user_id, region = EXCLUDED.region,
         role = EXCLUDED.role, is_staff = EXCLUDED.is_staff,
         guardian_link = EXCLUDED.guardian_link, reset_at = now()`,
      [
        login.email,
        login.userId,
        login.region,
        roleOf(login.email),
        staff.has(login.email),
        login.guardianLink ?? null,
      ],
    );
  }
  return {
    world,
    funded: funding.filter((f) => f.status === "funded").length,
    fundingFailures: funding
      .filter((f) => f.status === "failed")
      .map((f) => `${f.title}: ${f.detail ?? ""}`),
    logins,
  };
}
