import { describe, expect, it } from "vitest";
import { BOUNDARIES } from "./boundary";
import {
  ProductionStripeAddressError,
  StagingDriverModeError,
  assertDriversConfiguredForBoot,
} from "./driver-mode";

/** F106 posture: staging may run the Stripe driver against the simulation with a test key; production only talks to Stripe. */

const stripeLive = {
  PAYMENTS_DRIVER: "live",
  DISBURSEMENT_DRIVER: "live",
  STRIPE_WEBHOOK_SECRET: "whsec_x",
  STRIPE_API_BASE: "http://127.0.0.1:26301/api/paysim",
};

function thrown(run: () => unknown): unknown {
  try {
    run();
  } catch (error) {
    return error;
  }
  return undefined;
}

describe("the live credentials", () => {
  it("are Stripe's: payments needs the key and the webhook secret, disbursement the key", () => {
    expect(BOUNDARIES.payments.liveCredentialEnvVars).toStrictEqual([
      "STRIPE_SECRET_KEY",
      "STRIPE_WEBHOOK_SECRET",
    ]);
    expect(BOUNDARIES.disbursement.liveCredentialEnvVars).toStrictEqual(["STRIPE_SECRET_KEY"]);
    expect(BOUNDARIES.payments.liveVendor).toContain("Stripe");
    expect(BOUNDARIES.payments.liveVendor).toContain("F104");
    expect(BOUNDARIES.disbursement.liveVendor).toContain("Stripe Connect");
  });
});

describe("staging posture with Stripe (F106)", () => {
  it("boots with payments and disbursement live on a sk_test_ key", () => {
    const modes = assertDriversConfiguredForBoot(
      { ...stripeLive, STRIPE_SECRET_KEY: "sk_test_paysim" },
      "staging",
    );
    expect(modes.payments).toBe("live");
    expect(modes.disbursement).toBe("live");
  });

  it.each(["sk_live_real", "rk_test_scoped_key", "present"])(
    "refuses %s, naming both boundaries, without printing the key",
    (key) => {
      const error = thrown(() =>
        assertDriversConfiguredForBoot({ ...stripeLive, STRIPE_SECRET_KEY: key }, "staging"),
      );
      expect(error).toBeInstanceOf(StagingDriverModeError);
      const failure = error as StagingDriverModeError;
      expect(failure.boundaries).toStrictEqual(["payments", "disbursement"]);
      expect(failure.message).toContain("sk_test_");
      expect(failure.message).not.toContain(key);
    },
  );

  it("still refuses every other live boundary, even with a test key", () => {
    const error = thrown(() =>
      assertDriversConfiguredForBoot(
        {
          ...stripeLive,
          STRIPE_SECRET_KEY: "sk_test_paysim",
          MODERATION_DRIVER: "live",
          MODERATION_API_KEY: "k",
        },
        "staging",
      ),
    );
    expect(error).toBeInstanceOf(StagingDriverModeError);
    expect((error as StagingDriverModeError).boundaries).toStrictEqual(["moderation"]);
    expect((error as StagingDriverModeError).message).toContain("MODERATION_DRIVER=live");
  });
});

describe("production posture with Stripe", () => {
  const live = {
    PAYMENTS_DRIVER: "live",
    STRIPE_SECRET_KEY: "sk_live_x",
    STRIPE_WEBHOOK_SECRET: "whsec_x",
  };

  it.each([undefined, "https://api.stripe.com", "https://api.stripe.com/"])(
    "accepts STRIPE_API_BASE=%s",
    (base) => {
      const env = base === undefined ? live : { ...live, STRIPE_API_BASE: base };
      expect(() => assertDriversConfiguredForBoot(env, "production")).not.toThrow();
    },
  );

  it.each([
    "http://127.0.0.1:26301/api/paysim",
    "http://api.stripe.com",
    "https://api.stripe.com.evil.test",
    "https://api.stripe.com:8443",
    "not a url",
  ])("refuses STRIPE_API_BASE=%s", (base) => {
    expect(() =>
      assertDriversConfiguredForBoot({ ...live, STRIPE_API_BASE: base }, "production"),
    ).toThrow(ProductionStripeAddressError);
  });

  it("refuses the simulation's address on production even while payments are simulated", () => {
    expect(() =>
      assertDriversConfiguredForBoot(
        { STRIPE_API_BASE: "http://127.0.0.1:26301/api/paysim" },
        "production",
      ),
    ).toThrow(ProductionStripeAddressError);
  });

  it("leaves dev free to point anywhere", () => {
    expect(() =>
      assertDriversConfiguredForBoot({ ...live, STRIPE_API_BASE: "http://localhost:9999" }, "dev"),
    ).not.toThrow();
  });
});
