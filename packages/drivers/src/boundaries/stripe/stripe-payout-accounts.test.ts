import { describe, expect, it } from "vitest";
import { createStripePayoutAccounts } from "./stripe-payout-accounts";
import {
  type ScriptedAnswer,
  TEST_BASE,
  TEST_KEY,
  formLines,
  recordingFetch,
} from "./stripe-fetch-double";

function driver(...answers: ScriptedAnswer[]) {
  const double = recordingFetch(...answers);
  return {
    accounts: createStripePayoutAccounts({
      apiBase: TEST_BASE,
      secretKey: TEST_KEY,
      fetch: double.fetch,
      newKey: () => "fixed",
    }),
    calls: double.calls,
  };
}

describe("Stripe Connect payout accounts", () => {
  it.each([
    { kind: "business" as const, businessType: "company", schedule: "manual" as const },
    { kind: "charity" as const, businessType: "non_profit", schedule: "daily" as const },
  ])(
    "creates an AU Express account for a $kind on the $schedule schedule",
    async ({ kind, businessType, schedule }) => {
      const { accounts, calls } = driver({
        status: 200,
        body: { id: "acct_1", object: "account" },
      });
      const created = await accounts.createAccount({
        idempotencyKey: `payout-account:${kind}`,
        reference: `${kind}:1`,
        kind,
        email: "owner@example.test",
        payoutSchedule: schedule,
      });
      expect(created._unsafeUnwrap()).toStrictEqual({ accountRef: "acct_1" });
      expect(calls[0]?.url).toBe(`${TEST_BASE}/v1/accounts`);
      expect(calls[0]?.headers["Idempotency-Key"]).toBe(`payout-account:${kind}`);
      expect(calls[0]?.headers["Stripe-Account"]).toBeUndefined();
      expect(formLines(calls[0]?.body)).toStrictEqual([
        "type=express",
        "country=AU",
        "email=owner@example.test",
        `business_type=${businessType}`,
        "capabilities[transfers][requested]=true",
        "capabilities[card_payments][requested]=true",
        `settings[payouts][schedule][interval]=${schedule}`,
        `metadata[reference]=${kind}:1`,
        `metadata[kind]=${kind}`,
      ]);
    },
  );

  it.each([
    { purpose: "onboarding" as const, type: "account_onboarding" },
    { purpose: "update" as const, type: "account_update" },
  ])("makes an $purpose link with its expiry", async ({ purpose, type }) => {
    const { accounts, calls } = driver({
      status: 200,
      body: {
        object: "account_link",
        url: "http://paysim.test/connect/onboarding/t1",
        created: 1,
        expires_at: 1_800_001_800,
      },
    });
    const link = await accounts.onboardingLink({
      accountRef: "acct_1",
      returnUrl: "https://app.test/payouts/done",
      refreshUrl: "https://app.test/payouts/again",
      purpose,
    });
    expect(link._unsafeUnwrap()).toStrictEqual({
      url: "http://paysim.test/connect/onboarding/t1",
      expiresAt: new Date(1_800_001_800_000),
    });
    expect(calls[0]?.headers["Idempotency-Key"]).toBe("account-link:fixed");
    expect(formLines(calls[0]?.body)).toStrictEqual([
      "account=acct_1",
      "refresh_url=https://app.test/payouts/again",
      "return_url=https://app.test/payouts/done",
      `type=${type}`,
    ]);
  });

  it("reads an account's onboarding state and its bank account's last4", async () => {
    const { accounts, calls } = driver({
      status: 200,
      body: {
        id: "acct_1",
        charges_enabled: true,
        payouts_enabled: false,
        details_submitted: true,
        external_accounts: {
          object: "list",
          data: [{ id: "ba_1", last4: "3456", currency: "aud" }],
        },
      },
    });
    expect((await accounts.getAccount("acct_1"))._unsafeUnwrap()).toStrictEqual({
      accountRef: "acct_1",
      chargesEnabled: true,
      payoutsEnabled: false,
      detailsSubmitted: true,
      bankLast4: "3456",
    });
    expect(calls[0]?.url).toBe(`${TEST_BASE}/v1/accounts/acct_1`);
    expect(calls[0]?.method).toBe("GET");
  });

  it("an account not yet onboarded has no bank account", async () => {
    const { accounts } = driver({
      status: 200,
      body: { id: "acct_1", external_accounts: { data: [] } },
    });
    expect((await accounts.getAccount("acct_1"))._unsafeUnwrap()).toMatchObject({
      bankLast4: null,
      chargesEnabled: false,
    });
  });

  it("transfers from the platform balance to the account", async () => {
    const { accounts, calls } = driver({ status: 200, body: { id: "tr_1", object: "transfer" } });
    const transfer = await accounts.transfer({
      idempotencyKey: "statement:7:transfer",
      amountMinor: 9_900,
      currency: "AUD",
      accountRef: "acct_1",
      reference: "statement:7",
    });
    expect(transfer._unsafeUnwrap()).toStrictEqual({ transferRef: "tr_1" });
    expect(calls[0]?.url).toBe(`${TEST_BASE}/v1/transfers`);
    expect(calls[0]?.headers["Stripe-Account"]).toBeUndefined();
    expect(formLines(calls[0]?.body)).toStrictEqual([
      "amount=9900",
      "currency=aud",
      "destination=acct_1",
      "metadata[reference]=statement:7",
    ]);
  });

  it("pays out on the connected account itself, with Stripe-Account", async () => {
    const { accounts, calls } = driver({ status: 200, body: { id: "po_1", status: "pending" } });
    const payout = await accounts.payout({
      idempotencyKey: "statement:7:payout",
      amountMinor: 9_900,
      currency: "AUD",
      accountRef: "acct_1",
      reference: "statement:7",
    });
    expect(payout._unsafeUnwrap()).toStrictEqual({ payoutRef: "po_1", status: "pending" });
    expect(calls[0]?.url).toBe(`${TEST_BASE}/v1/payouts`);
    expect(calls[0]?.headers["Stripe-Account"]).toBe("acct_1");
    expect(calls[0]?.headers["Idempotency-Key"]).toBe("statement:7:payout");
    expect(formLines(calls[0]?.body)).toStrictEqual([
      "amount=9900",
      "currency=aud",
      "metadata[reference]=statement:7",
    ]);
  });

  it("maps an insufficient balance to declined, and refuses IDR without calling Stripe", async () => {
    const { accounts, calls } = driver({
      status: 400,
      body: {
        error: {
          type: "invalid_request_error",
          code: "balance_insufficient",
          message: "Insufficient funds",
        },
      },
    });
    const short = await accounts.payout({
      idempotencyKey: "p",
      amountMinor: 1,
      currency: "AUD",
      accountRef: "acct_1",
      reference: "r",
    });
    expect(short._unsafeUnwrapErr()).toMatchObject({
      kind: "declined",
      boundary: "disbursement",
      mayHaveSucceeded: false,
    });
    const idr = await accounts.transfer({
      idempotencyKey: "t",
      amountMinor: 45_000,
      currency: "IDR",
      accountRef: "acct_1",
      reference: "r",
    });
    expect(idr._unsafeUnwrapErr().kind).toBe("declined");
    expect(calls).toHaveLength(1);
  });
});
