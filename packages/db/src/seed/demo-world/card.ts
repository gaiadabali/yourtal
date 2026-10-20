import { field, ok, sleep } from "./api-client";
import type { DemoApi } from "./api-client";

/** Stripe's test card that pays and saves. Staging runs Stripe against the payment simulation (F106). */
const TEST_CARD = { number: "4242 4242 4242 4242", expiry: "12 / 34", cvc: "123" };

/**
 * 5.1.a: where boosts charge a saved card (AU on Stripe), the demo business
 * saves one through the real card route and the simulation's checkout page,
 * as a person would, then waits for the webhook to store it. With simulated
 * payments no card is required and this does nothing.
 */
export async function ensureDemoCard(owner: DemoApi, businessId: string): Promise<void> {
  await ensureCardAt(owner, `/api/${businessId}/studio/billing/card`, `business ${businessId}`);
}

/**
 * 5.1.d: the same for a demo bidder, through `/api/me/payment-card`. Resolves to whether a card is
 * saved: false (and nothing done) where the region's processor needs none.
 */
export async function ensureBidderCard(bidder: DemoApi, who: string): Promise<boolean> {
  return ensureCardAt(bidder, "/api/me/payment-card", who);
}

async function ensureCardAt(person: DemoApi, cardPath: string, who: string): Promise<boolean> {
  const current = ok(await person.get(cardPath), "card");
  if (field(current, "required") !== true) return false;
  if (field(current, "card") !== null) return true;

  const started = ok(await person.post(cardPath), "start card setup");
  const checkoutUrl = field(started, "checkoutUrl");
  if (typeof checkoutUrl !== "string") return true; // saved at once
  await submitTestCard(checkoutUrl);

  // The card arrives with the simulation's webhook, delivered every few seconds.
  for (let attempt = 0; attempt < 30; attempt += 1) {
    if (field(ok(await person.get(cardPath), "card"), "card") !== null) return true;
    await sleep(2_000);
  }
  throw new Error(`demo card for ${who}: the card was not saved within a minute`);
}

/** Loads the checkout page, reads its CSRF token as a form would, and posts the test card. */
async function submitTestCard(checkoutUrl: string): Promise<void> {
  const page = await fetch(checkoutUrl, { redirect: "manual" });
  const csrf = /name="csrf" value="([^"]+)"/.exec(await page.text())?.[1];
  if (page.status !== 200 || csrf === undefined) {
    throw new Error(`demo card: the checkout page answered ${String(page.status)} without a form`);
  }
  const submitted = await fetch(checkoutUrl, {
    method: "POST",
    redirect: "manual",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ csrf, ...TEST_CARD }).toString(),
  });
  // A saved card sends the browser back to Studio with a 303.
  if (submitted.status !== 303) {
    throw new Error(`demo card: the checkout page answered ${String(submitted.status)}`);
  }
}
