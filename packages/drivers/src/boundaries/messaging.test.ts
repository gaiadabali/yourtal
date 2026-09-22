import { describe, expect, it } from "vitest";
import { SIMULATED_TEMPLATES, createSimulatedMessaging } from "./messaging";

/**
 * YT-0538's title names messaging alongside bot-check and OTP. Its behaviour
 * was already built (idempotent send, approved-template gating, replayable
 * deliveries) but had no dedicated test — only the generic fault exercise in
 * `unhappy-path.test.ts`. This closes that gap.
 */

describe("messaging", () => {
  it("declines a template that was never approved, as an answer, not an outage", async () => {
    const driver = createSimulatedMessaging();
    const result = await driver.send({
      idempotencyKey: "key-1",
      to: "+6281234567890",
      template: "not_a_real_template",
      variables: {},
    });
    expect(result.isErr()).toBe(true);
    const failure = result._unsafeUnwrapErr();
    expect(failure.kind).toBe("declined");
    expect(failure.mayHaveSucceeded).toBe(false);
  });

  it("sends every approved template", async () => {
    const driver = createSimulatedMessaging();
    for (const template of SIMULATED_TEMPLATES) {
      const result = await driver.send({
        idempotencyKey: `key-${template}`,
        to: "+6281234567890",
        template,
        variables: {},
      });
      expect(result.isOk()).toBe(true);
    }
  });

  it("a replayed idempotency key returns the ORIGINAL message, not a second one", async () => {
    const driver = createSimulatedMessaging();
    const first = (
      await driver.send({
        idempotencyKey: "key-1",
        to: "+6281234567890",
        template: "voucher_issued",
        variables: {},
      })
    )._unsafeUnwrap();

    const replay = (
      await driver.send({
        idempotencyKey: "key-1",
        // Different recipient/template on the replay: if this were treated
        // as a new send rather than a replay, the assertion below on
        // `providerReference` would still pass by accident. It is here so
        // a future refactor that starts re-deriving the reference from the
        // request body — instead of the stored replay — fails loudly.
        to: "+6289999999999",
        template: "payout_sent",
        variables: {},
      })
    )._unsafeUnwrap();

    expect(replay).toStrictEqual(first);
  });
});
