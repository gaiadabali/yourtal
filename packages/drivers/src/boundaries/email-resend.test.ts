import { describe, expect, it, vi } from "vitest";
import { createDrivers } from "../registry";
import { createEmailDriver, type EmailMessage } from "./email";
import { createResendEmail } from "./email-resend";

const message: EmailMessage = {
  idempotencyKey: "key-1",
  to: "person@example.test",
  region: "AU",
  category: "email_verification",
  subject: "Verify your email",
  body: "Click the link.",
};

function driverWith(fetchImpl: unknown, timeoutMs?: number) {
  return createResendEmail({
    apiKey: "re_test_key",
    from: "YourTal <no-reply@example.test>",
    fetch: fetchImpl as typeof fetch,
    ...(timeoutMs === undefined ? {} : { timeoutMs }),
  });
}

const reply = (status: number, body: unknown) =>
  vi.fn(() => Promise.resolve(new Response(JSON.stringify(body), { status })));

describe("resend email driver", () => {
  it("posts to Resend with auth and an idempotency key, returns the message id", async () => {
    const fetchMock = reply(200, { id: "msg_123" });
    const result = await driverWith(fetchMock).send(message);

    expect(result._unsafeUnwrap()).toStrictEqual({ id: "msg_123", route: "live" });
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.resend.com/emails");
    expect(init.method).toBe("POST");
    const headers = init.headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer re_test_key");
    expect(headers["Idempotency-Key"]).toBe("key-1");
    expect(JSON.parse(init.body as string)).toStrictEqual({
      from: "YourTal <no-reply@example.test>",
      to: ["person@example.test"],
      subject: "Verify your email",
      text: "Click the link.",
    });
  });

  it("maps a 4xx validation error to declined, not retryable", async () => {
    const result = await driverWith(reply(422, { name: "validation_error" })).send(message);
    const failure = result._unsafeUnwrapErr();
    expect(failure).toMatchObject({ kind: "declined", boundary: "email", mayHaveSucceeded: false });
    expect(failure.detail).not.toContain("person@example.test");
  });

  it("maps 429 to a retryable server_error that did not send", async () => {
    const result = await driverWith(reply(429, { name: "rate_limit_exceeded" })).send(message);
    expect(result._unsafeUnwrapErr()).toMatchObject({
      kind: "server_error",
      mayHaveSucceeded: false,
    });
  });

  it("maps 5xx to a retryable server_error", async () => {
    const result = await driverWith(reply(503, { name: "application_error" })).send(message);
    expect(result._unsafeUnwrapErr()).toMatchObject({
      kind: "server_error",
      mayHaveSucceeded: true,
    });
  });

  it("maps a network error to server_error and never leaks the key", async () => {
    const fetchMock = vi.fn(() => Promise.reject(new Error("ECONNRESET re_test_key")));
    const failure = (await driverWith(fetchMock).send(message))._unsafeUnwrapErr();
    expect(failure.kind).toBe("server_error");
    expect(JSON.stringify(failure)).not.toContain("re_test_key");
  });

  it("maps a timeout to a timeout failure", async () => {
    const hang = vi.fn(
      (_url: string, init: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init.signal?.addEventListener("abort", () => {
            reject(init.signal?.reason as Error);
          });
        }),
    );
    const result = await driverWith(hang, 20).send(message);
    expect(result._unsafeUnwrapErr()).toMatchObject({ kind: "timeout", mayHaveSucceeded: true });
  });

  it("treats a 2xx without an id as a failure", async () => {
    const result = await driverWith(reply(200, {})).send(message);
    expect(result.isErr()).toBe(true);
  });
});

describe("live email boot", () => {
  it("refuses to boot without EMAIL_API_KEY", () => {
    expect(() => createDrivers({ EMAIL_DRIVER: "live", EMAIL_FROM: "a@example.test" })).toThrow(
      /EMAIL_API_KEY/,
    );
  });

  it("refuses to boot without EMAIL_FROM", () => {
    expect(() => createDrivers({ EMAIL_DRIVER: "live", EMAIL_API_KEY: "k" })).toThrow(/EMAIL_FROM/);
  });

  it("builds a live driver when configured", () => {
    const driver = createEmailDriver("live", { EMAIL_API_KEY: "k", EMAIL_FROM: "a@example.test" });
    expect(driver.mode).toBe("live");
  });
});
