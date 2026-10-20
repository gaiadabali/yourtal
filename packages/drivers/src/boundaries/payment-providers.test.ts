import { describe, expect, it } from "vitest";
import { DriverConfigurationError } from "../driver-mode";
import { createPaymentProviders } from "./payment-providers";
import { formLines, recordingFetch } from "./stripe/stripe-fetch-double";

const STRIPE = {
  STRIPE_SECRET_KEY: "sk_test_router",
  STRIPE_WEBHOOK_SECRET: "whsec_router",
  STRIPE_API_BASE: "http://127.0.0.1:26301/api/paysim",
};

describe("createPaymentProviders", () => {
  it("is simulated in both regions by default", () => {
    const providers = createPaymentProviders({});
    for (const region of ["AU", "ID"] as const) {
      expect(providers[region].payments.provider).toBe("simulated");
      expect(providers[region].marketplace.provider).toBe("simulated");
      expect(providers[region].payoutAccounts.provider).toBe("simulated");
    }
    // The simulated drivers speak both currencies, so ID's IDR is never refused for want of a declaration.
    expect(providers.ID.payments.declaredMinorUnitExponent).toStrictEqual({ AUD: 2, IDR: 0 });
    expect(providers.ID.payoutAccounts.declaredMinorUnitExponent).toStrictEqual({ AUD: 2, IDR: 0 });
  });

  it("puts AU on Stripe when both drivers are live, and leaves ID simulated (F104)", () => {
    const providers = createPaymentProviders({
      ...STRIPE,
      PAYMENTS_DRIVER: "live",
      DISBURSEMENT_DRIVER: "live",
    });
    expect(providers.AU.payments.provider).toBe("stripe");
    expect(providers.AU.marketplace.provider).toBe("stripe");
    expect(providers.AU.payoutAccounts.provider).toBe("stripe");
    expect(providers.ID.payments.provider).toBe("simulated");
    expect(providers.ID.marketplace.provider).toBe("simulated");
    expect(providers.ID.payoutAccounts.provider).toBe("simulated");
  });

  it("switches payments and payout accounts independently", () => {
    const paymentsOnly = createPaymentProviders({ ...STRIPE, PAYMENTS_DRIVER: "live" });
    expect(paymentsOnly.AU.payments.provider).toBe("stripe");
    expect(paymentsOnly.AU.payoutAccounts.provider).toBe("simulated");
    const payoutsOnly = createPaymentProviders({
      STRIPE_SECRET_KEY: "sk_test_x",
      DISBURSEMENT_DRIVER: "live",
    });
    expect(payoutsOnly.AU.payments.provider).toBe("simulated");
    expect(payoutsOnly.AU.payoutAccounts.provider).toBe("stripe");
  });

  it("points the AU Stripe drivers at STRIPE_API_BASE with the injected fetch", async () => {
    const double = recordingFetch({ status: 200, body: { id: "cus_1" } });
    const providers = createPaymentProviders(
      { ...STRIPE, PAYMENTS_DRIVER: "live" },
      { fetch: double.fetch },
    );
    const created = await providers.AU.payments.createCustomer({
      idempotencyKey: "k",
      reference: "user:1",
    });
    expect(created._unsafeUnwrap()).toStrictEqual({ customerRef: "cus_1" });
    expect(double.calls[0]?.url).toBe("http://127.0.0.1:26301/api/paysim/v1/customers");
    expect(double.calls[0]?.headers.Authorization).toBe("Bearer sk_test_router");
    expect(formLines(double.calls[0]?.body)).toStrictEqual(["metadata[reference]=user:1"]);
  });

  it("refuses a live driver without its credentials rather than falling back", () => {
    expect(() => createPaymentProviders({ PAYMENTS_DRIVER: "live" })).toThrow(
      DriverConfigurationError,
    );
    expect(() => createPaymentProviders({ DISBURSEMENT_DRIVER: "Live" })).toThrow(
      DriverConfigurationError,
    );
  });
});
