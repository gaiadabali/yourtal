import { field, ok, sleep } from "./api-client";
import type { DemoApi } from "./api-client";

/** Stripe's AU test bank account that pays out. Staging runs Stripe against the payment simulation (F106). */
const TEST_BANK = { bsb: "110000", account: "000123456" };

/**
 * 5.2: where AU payouts run on Stripe, a demo brand or charity sets up its
 * payout account through the real route and the simulation's onboarding
 * page, as a person would, then waits for the webhook to mark it ready. With
 * simulated payouts (no hosted page) or outside Australia this does nothing.
 */
export async function ensureDemoPayouts(
  api: DemoApi,
  statusPath: string,
  what: string,
): Promise<void> {
  const read = async () => field(ok(await api.get(statusPath), `${what} payouts`), "account");
  const account = await read();
  if (
    field(account, "available") !== true ||
    field(account, "hostedOnboarding") !== true ||
    field(account, "state") === "ready"
  ) {
    return;
  }
  const url = field(ok(await api.post(`${statusPath}/link`), `${what} payout link`), "url");
  if (typeof url !== "string") throw new Error(`demo payouts for ${what}: no onboarding link`);
  await submitTestBank(url, what);

  // account.updated arrives with the simulation's webhook, delivered every few seconds.
  for (let attempt = 0; attempt < 30; attempt += 1) {
    if (field(await read(), "state") === "ready") return;
    await sleep(2_000);
  }
  throw new Error(`demo payouts for ${what}: the account was not ready within a minute`);
}

/** Loads the onboarding page, reads its CSRF token as a form would, and posts the test bank account. */
async function submitTestBank(url: string, what: string): Promise<void> {
  const page = await fetch(url, { redirect: "manual" });
  const csrf = /name="csrf" value="([^"]+)"/.exec(await page.text())?.[1];
  if (page.status !== 200 || csrf === undefined) {
    throw new Error(
      `demo payouts for ${what}: the onboarding page answered ${String(page.status)}`,
    );
  }
  const submitted = await fetch(url, {
    method: "POST",
    redirect: "manual",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ csrf, legal_name: what, ...TEST_BANK }).toString(),
  });
  // A finished onboarding sends the browser back to the app with a 303.
  if (submitted.status !== 303) {
    throw new Error(
      `demo payouts for ${what}: the onboarding page answered ${String(submitted.status)}`,
    );
  }
}
