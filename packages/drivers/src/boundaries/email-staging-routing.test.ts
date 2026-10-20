import { afterEach, describe, expect, it, vi } from "vitest";
import { createEmailDriver, type EmailMessage } from "./email";
import { createInMemorySimOutboxStore } from "../sim-outbox";

/**
 * Staging runs `EMAIL_DRIVER=live` with `EMAIL_LIVE_ALLOWLIST=@gaiada.com`
 * (F115). This pins the whole staging stack through `createEmailDriver`, as
 * the API builds it, for the guardian approval email: a listed guardian is
 * handed to Resend with the same shape a password reset gets, an unlisted one
 * lands in the simulated outbox, and a refusal from Resend comes back as a
 * failure the caller can log (group 1.3.c).
 */

const env = {
  EMAIL_API_KEY: "test-key-not-real",
  EMAIL_FROM: "YourTal <noreply@mail.example.test>",
  EMAIL_LIVE_ALLOWLIST: "@gaiada.com",
};

function guardianMessage(to: string): EmailMessage {
  return {
    idempotencyKey: `hash-${to}`,
    to,
    region: "AU",
    category: "guardian_consent",
    subject: "Guardian approval for YourTal",
    body: "Approve: https://staging.example.test/guardian/abc\nWithdraw: https://staging.example.test/guardian/abc?action=revoke",
    metadata: { token: "not-a-real-token" },
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("staging email stack, guardian_consent", () => {
  it("hands a listed guardian to Resend and reports the route and message id", async () => {
    const fetchMock = vi.fn(() =>
      Promise.resolve(new Response(JSON.stringify({ id: "re_123" }), { status: 200 })),
    );
    vi.stubGlobal("fetch", fetchMock);
    const store = createInMemorySimOutboxStore();
    const driver = createEmailDriver("live", env, undefined, store);

    const result = await driver.send(guardianMessage("Hansel+yt-guardian@gaiada.com"));

    expect(result._unsafeUnwrap()).toStrictEqual({ id: "re_123", route: "live" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    const sent = JSON.parse(init.body as string) as Record<string, unknown>;
    expect(sent["to"]).toEqual(["Hansel+yt-guardian@gaiada.com"]);
    expect(sent["subject"]).toBe("Guardian approval for YourTal");
    expect((init.headers as Record<string, string>)["Idempotency-Key"]).toBe(
      "hash-Hansel+yt-guardian@gaiada.com",
    );
  });

  it("puts an unlisted guardian in the simulated outbox and never calls Resend", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const store = createInMemorySimOutboxStore();
    const driver = createEmailDriver("live", env, undefined, store);

    const result = await driver.send(guardianMessage("guardian-dbg@example.test"));

    expect(result._unsafeUnwrap().route).toBe("simulated");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns Resend's refusal as a failure with the status and error name, not the address", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        Promise.resolve(
          new Response(JSON.stringify({ name: "validation_error", message: "bad" }), {
            status: 422,
          }),
        ),
      ),
    );
    const driver = createEmailDriver("live", env, undefined, createInMemorySimOutboxStore());

    const failure = (
      await driver.send(guardianMessage("hansel+yt-guardian@gaiada.com"))
    )._unsafeUnwrapErr();

    expect(failure.kind).toBe("declined");
    expect(failure.detail).toContain("422 validation_error");
    expect(failure.detail).not.toContain("gaiada.com");
  });
});
