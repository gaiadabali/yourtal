import { err, ok } from "neverthrow";
import { describe, expect, it } from "vitest";
import { createSimulatedPayoutAccounts } from "@yourtal/drivers/payout-accounts";
import type {
  CreatePayoutAccountRequest,
  OnboardingLinkRequest,
  PayoutAccount,
  PayoutAccountsDriver,
} from "@yourtal/drivers/payout-accounts";
import type { RegionPaymentProviders } from "../../shared/drivers/payment-providers.module";
import { PaymentEventHandlers } from "../payments/payment-event-handlers";
import type { ConnectedAccountRow, PayoutOwner } from "./connected-account.repository";
import { ConnectedAccountsService } from "./connected-accounts.service";
import type { ConnectedAccountStore } from "./connected-accounts.service";
import type { PayoutOutcome } from "./disbursement.repository";

const BRAND: PayoutOwner = {
  kind: "business",
  id: "b0000000-0000-4000-8000-000000000001",
  region: "AU",
};
const CHARITY: PayoutOwner = {
  kind: "charity",
  id: "c0000000-0000-4000-8000-000000000001",
  region: "AU",
};
const PATHS = {
  returnPath: "/studio/billing?business=x",
  refreshPath: "/studio/billing/payouts/refresh",
};

function memoryStore(): ConnectedAccountStore & { updates: number; rows: ConnectedAccountRow[] } {
  const rows: ConnectedAccountRow[] = [];
  const store = {
    rows,
    updates: 0,
    findByOwner: (owner: PayoutOwner) =>
      Promise.resolve(
        rows.find((r) => r.owner.kind === owner.kind && r.owner.id === owner.id) ?? null,
      ),
    findByRef: (ref: string) => Promise.resolve(rows.find((r) => r.accountRef === ref) ?? null),
    save: (owner: PayoutOwner, provider: "stripe" | "simulated", accountRef: string) => {
      const existing = rows.find((r) => r.owner.id === owner.id);
      if (existing !== undefined) return Promise.resolve(existing);
      const row: ConnectedAccountRow = {
        owner,
        provider,
        accountRef,
        chargesEnabled: false,
        payoutsEnabled: false,
        detailsSubmitted: false,
        bankLast4: null,
      };
      rows.push(row);
      return Promise.resolve(row);
    },
    update: (account: PayoutAccount) => {
      store.updates += 1;
      const index = rows.findIndex((r) => r.accountRef === account.accountRef);
      const current = rows[index];
      if (current === undefined) return Promise.resolve(null);
      const next = { ...current, ...account };
      rows[index] = next;
      return Promise.resolve(next);
    },
  };
  return store;
}

/** Stripe's shape: the account stays empty until the page is filled in (`provider.onboard`). */
function stripeShaped() {
  const created: CreatePayoutAccountRequest[] = [];
  const links: OnboardingLinkRequest[] = [];
  const accounts = new Map<string, PayoutAccount>();
  const driver: PayoutAccountsDriver = {
    ...createSimulatedPayoutAccounts(),
    mode: "live",
    provider: "stripe",
    createAccount: (request) => {
      created.push(request);
      const accountRef = `acct_${request.idempotencyKey.slice(-6)}`;
      accounts.set(accountRef, {
        accountRef,
        chargesEnabled: false,
        payoutsEnabled: false,
        detailsSubmitted: false,
        bankLast4: null,
      });
      return Promise.resolve(ok({ accountRef }));
    },
    onboardingLink: (request) => {
      links.push(request);
      return Promise.resolve(
        ok({ url: "https://connect.test/onboarding/tok", expiresAt: new Date() }),
      );
    },
    getAccount: (ref) => {
      const account = accounts.get(ref);
      return Promise.resolve(
        account === undefined
          ? err({
              kind: "declined",
              boundary: "disbursement",
              detail: "no such",
              mayHaveSucceeded: false,
            })
          : ok(account),
      );
    },
  };
  const onboard = (ref: string, bankLast4 = "3456") =>
    accounts.set(ref, {
      accountRef: ref,
      chargesEnabled: true,
      payoutsEnabled: true,
      detailsSubmitted: true,
      bankLast4,
    });
  return { driver, created, links, onboard };
}

/** A link that must open. */
async function linked(
  service: ConnectedAccountsService,
  owner: PayoutOwner,
  paths: Parameters<ConnectedAccountsService["startLink"]>[1],
) {
  expect((await service.startLink(owner, paths)).isOk()).toBe(true);
}

function setup(driver: PayoutAccountsDriver) {
  const store = memoryStore();
  const providers = { AU: { payoutAccounts: driver } } as unknown as RegionPaymentProviders;
  const service = new ConnectedAccountsService(providers, store, "https://yourtal.test");
  const handlers = new PaymentEventHandlers();
  const settled: PayoutOutcome[] = [];
  service.registerHandlers(handlers, {
    settlePayout: (outcome) => {
      settled.push(outcome);
      return Promise.resolve(true);
    },
  });
  return { service, store, handlers, settled };
}

const accountUpdated = (accountRef: string) => ({
  type: "account.updated" as const,
  eventId: `evt_${accountRef}`,
  accountRef,
  chargesEnabled: true,
  payoutsEnabled: true,
  detailsSubmitted: true,
  bankLast4: "3456",
});

describe("ConnectedAccountsService (5.2)", () => {
  it("has nothing outside Australia", async () => {
    const { service } = setup(stripeShaped().driver);
    expect(await service.status(null)).toEqual({
      available: false,
      state: "not_started",
      bankLast4: null,
      hostedOnboarding: false,
    });
  });

  it("creates one account per owner, brands on manual and charities on daily payouts", async () => {
    const stripe = stripeShaped();
    const { service, store } = setup(stripe.driver);
    await linked(service, BRAND, PATHS);
    await linked(service, BRAND, PATHS);
    await linked(service, CHARITY, {
      returnPath: "/charity/c",
      refreshPath: "/charity/c/payouts/refresh",
    });

    expect(stripe.created.map((c) => [c.idempotencyKey, c.kind, c.payoutSchedule])).toEqual([
      [`connected-account:business:${BRAND.id}`, "business", "manual"],
      [`connected-account:charity:${CHARITY.id}`, "charity", "daily"],
    ]);
    expect(store.rows).toHaveLength(2);
    expect(stripe.links[0]).toMatchObject({
      purpose: "onboarding",
      returnUrl: "https://yourtal.test/studio/billing?business=x&payouts=returned",
      refreshUrl: "https://yourtal.test/studio/billing/payouts/refresh",
    });
  });

  it("refuses to send the browser anywhere but the web app", async () => {
    const { service } = setup(stripeShaped().driver);
    await expect(
      service.startLink(BRAND, { returnPath: "//evil.test/x", refreshPath: "/r" }),
    ).rejects.toThrow(/paths on the web app/);
  });

  it("re-reads the account on account.updated, then offers a bank-details update", async () => {
    const stripe = stripeShaped();
    const { service, handlers } = setup(stripe.driver);
    const ready: string[] = [];
    service.whenReady((row) => {
      ready.push(row.accountRef);
      return Promise.resolve();
    });
    await linked(service, BRAND, PATHS);
    const ref = (await service.findForOwner(BRAND))?.accountRef ?? "";
    expect((await service.status(BRAND)).state).toBe("in_progress");

    stripe.onboard(ref);
    await handlers.dispatch(accountUpdated(ref));
    expect(await service.status(BRAND)).toEqual({
      available: true,
      state: "ready",
      bankLast4: "3456",
      hostedOnboarding: true,
    });
    expect(ready).toEqual([ref]);

    await linked(service, BRAND, PATHS);
    expect(stripe.links.at(-1)?.purpose).toBe("update");
  });

  it("ignores an account that is not ours, and fails loudly when the re-read fails", async () => {
    const stripe = stripeShaped();
    const { handlers, store } = setup(stripe.driver);
    await handlers.dispatch(accountUpdated("acct_someone_else"));
    expect(store.updates).toBe(0);

    store.rows.push({
      owner: BRAND,
      provider: "stripe",
      accountRef: "acct_gone",
      chargesEnabled: false,
      payoutsEnabled: false,
      detailsSubmitted: false,
      bankLast4: null,
    });
    await expect(handlers.dispatch(accountUpdated("acct_gone"))).rejects.toThrow(/acct_gone/);
  });

  it("does not count looking at the page as an account update", async () => {
    const stripe = stripeShaped();
    const { service, store } = setup(stripe.driver);
    await linked(service, BRAND, PATHS);
    await service.status(BRAND);
    await service.status(BRAND);
    expect(store.updates).toBe(0);
  });

  it("hands each payout's outcome to the disbursements", async () => {
    const { handlers, settled } = setup(stripeShaped().driver);
    const payout = {
      eventId: "evt_p",
      accountRef: "acct_1",
      payoutRef: "po_1",
      reference: "disbursement:x:1",
      amountMinor: 100,
      currency: "AUD" as const,
    };
    await handlers.dispatch({ ...payout, type: "payout.paid", failureCode: null });
    await handlers.dispatch({ ...payout, type: "payout.failed", failureCode: "no_account" });
    expect(settled.map((s) => [s.outcome, s.payoutRef, s.failureCode])).toEqual([
      ["paid", "po_1", null],
      ["failed", "po_1", "no_account"],
    ]);
  });

  it("is ready at once on the simulated provider, which asks nothing", async () => {
    const { service } = setup(createSimulatedPayoutAccounts());
    const link = await service.startLink(BRAND, PATHS);
    expect(link.isOk() ? link.value.url : link.error.detail).toBe(
      "https://yourtal.test/studio/billing?business=x&payouts=returned",
    );
    expect(await service.status(BRAND)).toMatchObject({ state: "ready", hostedOnboarding: false });
  });
});
