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

  describe("read-back", () => {
    const since = new Date("2026-10-20T00:00:00Z");
    const sinceUnix = String(since.getTime() / 1_000);
    const find = { accountRef: "acct_1", reference: "disbursement:7:1", since };
    const poBody = (extra: Record<string, unknown> = {}) => ({
      id: "po_1",
      object: "payout",
      status: "pending",
      amount: 9_900,
      currency: "aud",
      failure_code: null,
      metadata: { reference: "disbursement:7:1" },
      ...extra,
    });
    const filler = (id: string) => poBody({ id, metadata: { reference: "x" } });
    const trBody = (extra: Record<string, unknown> = {}) => ({
      id: "tr_1",
      object: "transfer",
      amount: 9_900,
      currency: "aud",
      metadata: { reference: "disbursement:7" },
      ...extra,
    });
    const list = (data: unknown[], hasMore = false) => ({
      status: 200,
      body: { object: "list", data, has_more: hasMore },
    });

    it("reads a payout on the connected account", async () => {
      const { accounts, calls } = driver({ status: 200, body: poBody() });
      expect((await accounts.getPayout("acct_1", "po_1"))._unsafeUnwrap()).toStrictEqual({
        payoutRef: "po_1",
        status: "pending",
        amountMinor: 9_900,
        currency: "AUD",
        reference: "disbursement:7:1",
        failureCode: null,
      });
      expect(calls[0]?.method).toBe("GET");
      expect(calls[0]?.url).toBe(`${TEST_BASE}/v1/payouts/po_1`);
      expect(calls[0]?.headers["Stripe-Account"]).toBe("acct_1");
    });

    it.each([
      [{ status: "paid" }, "paid", null],
      [{ status: "pending" }, "pending", null],
      [{ status: "in_transit" }, "pending", null],
      [{ status: "failed", failure_code: "no_account" }, "failed", "no_account"],
      [{ status: "failed" }, "failed", "payout_failed"],
      [{ status: "canceled" }, "failed", "canceled"],
    ])("maps %j to %s", async (extra, status, failureCode) => {
      const { accounts } = driver({ status: 200, body: poBody(extra) });
      expect((await accounts.getPayout("acct_1", "po_1"))._unsafeUnwrap()).toMatchObject({
        status,
        failureCode,
      });
    });

    it("has no reference when none was sent", async () => {
      const { accounts } = driver({ status: 200, body: poBody({ metadata: {} }) });
      expect((await accounts.getPayout("acct_1", "po_1"))._unsafeUnwrap().reference).toBeNull();
    });

    it.each([
      ["an unknown status", { status: "weird" }],
      ["a missing id", { id: undefined }],
      ["a missing amount", { amount: undefined }],
      ["a fractional amount", { amount: 9.5 }],
      ["an unknown currency", { currency: "usd" }],
    ])("treats %s as an unexpected answer", async (_name, extra) => {
      const { accounts } = driver({ status: 200, body: poBody(extra) });
      expect((await accounts.getPayout("acct_1", "po_1"))._unsafeUnwrapErr()).toMatchObject({
        kind: "server_error",
        mayHaveSucceeded: true,
      });
    });

    it("declines a payout Stripe does not know", async () => {
      const { accounts } = driver({
        status: 404,
        body: {
          error: {
            type: "invalid_request_error",
            code: "resource_missing",
            message: "No such payout",
          },
        },
      });
      expect((await accounts.getPayout("acct_1", "po_x"))._unsafeUnwrapErr()).toMatchObject({
        kind: "declined",
        mayHaveSucceeded: false,
      });
    });

    it("finds a payout by reference on the account, since the given time", async () => {
      const { accounts, calls } = driver(list([filler("po_other"), poBody()]));
      const found = await accounts.findPayout(find);
      expect(found._unsafeUnwrap()).toMatchObject({ payoutRef: "po_1", status: "pending" });
      expect(calls).toHaveLength(1);
      expect(decodeURIComponent(calls[0]?.url ?? "")).toBe(
        `${TEST_BASE}/v1/payouts?limit=100&created[gte]=${sinceUnix}`,
      );
      expect(calls[0]?.headers["Stripe-Account"]).toBe("acct_1");
    });

    it("pages on with starting_after until a match, or null once the list ends", async () => {
      const hit = driver(list([filler("po_a"), filler("po_b")], true), list([poBody()]));
      expect((await hit.accounts.findPayout(find))._unsafeUnwrap()?.payoutRef).toBe("po_1");
      expect(hit.calls).toHaveLength(2);
      expect(hit.calls[1]?.url).toContain("starting_after=po_b");

      const miss = driver(list([filler("po_a")], true), list([filler("po_b")]));
      expect((await miss.accounts.findPayout(find))._unsafeUnwrap()).toBeNull();
      expect(miss.calls).toHaveLength(2);
    });

    it("will not call 'nothing found' when the page cap stops the scan", async () => {
      const { accounts, calls } = driver(list([filler("po_1")], true));
      expect((await accounts.findPayout(find))._unsafeUnwrapErr()).toMatchObject({
        kind: "server_error",
        boundary: "disbursement",
        mayHaveSucceeded: true,
      });
      expect(calls).toHaveLength(10);
    });

    it("refuses a list answer that is not a list", async () => {
      const { accounts } = driver({ status: 200, body: { object: "list" } });
      const failed = await accounts.findTransfer(find);
      expect(failed._unsafeUnwrapErr().mayHaveSucceeded).toBe(true);
    });

    it("finds a transfer by reference with the platform key and no Stripe-Account", async () => {
      const { accounts, calls } = driver(list([trBody({ id: "tr_x", metadata: {} }), trBody()]));
      const found = await accounts.findTransfer({ ...find, reference: "disbursement:7" });
      expect(found._unsafeUnwrap()).toStrictEqual({
        transferRef: "tr_1",
        amountMinor: 9_900,
        currency: "AUD",
        reference: "disbursement:7",
      });
      expect(decodeURIComponent(calls[0]?.url ?? "")).toBe(
        `${TEST_BASE}/v1/transfers?destination=acct_1&limit=100&created[gte]=${sinceUnix}`,
      );
      expect(calls[0]?.headers["Stripe-Account"]).toBeUndefined();
    });

    it("returns null for a transfer nobody sent, and the page cap error for a long list", async () => {
      const none = driver(list([trBody()]));
      expect((await none.accounts.findTransfer(find))._unsafeUnwrap()).toBeNull();
      const long = driver(list([trBody({ metadata: {} })], true));
      expect((await long.accounts.findTransfer(find))._unsafeUnwrapErr().mayHaveSucceeded).toBe(
        true,
      );
      expect(long.calls).toHaveLength(10);
    });
  });
});
