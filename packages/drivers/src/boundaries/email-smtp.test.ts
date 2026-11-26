import { type Socket, createServer } from "node:net";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { EmailMessage } from "./email";
import {
  type SmtpTransport,
  classifySmtpError,
  createSmtpEmail,
  parseSmtpUrl,
  smtpConfigFromEnv,
} from "./email-smtp";
import { type TestSmtpServer, startTestSmtpServer } from "./email-smtp-test-server";

const message: EmailMessage = {
  idempotencyKey: "key-1",
  to: "person@example.test",
  region: "AU",
  category: "email_verification",
  subject: "Verify your email",
  body: "Click the link.",
};
const from = "YourTal <no-reply@example.test>";

function fakeTransport(info: Awaited<ReturnType<SmtpTransport["sendMail"]>> | Error) {
  return vi.fn(() => (info instanceof Error ? Promise.reject(info) : Promise.resolve(info)));
}

function driverWith(transport: SmtpTransport) {
  return createSmtpEmail({ url: "smtp://relay.example.test:587", from, transport });
}

const nodemailerError = (props: Record<string, unknown>) =>
  Object.assign(new Error("boom: person@example.test"), props);

describe("smtp url and security rules", () => {
  it("defaults the port per scheme and requires STARTTLS on smtp://", () => {
    expect(parseSmtpUrl({ url: "smtp://relay.example.test", from })).toStrictEqual({
      host: "relay.example.test",
      port: 587,
      secure: false,
      requireTLS: true,
      ignoreTLS: false,
    });
  });

  it("uses implicit TLS on smtps:// and decodes credentials", () => {
    expect(parseSmtpUrl({ url: "smtps://us%40er:p%3Ass@relay.example.test", from })).toStrictEqual({
      host: "relay.example.test",
      port: 465,
      secure: true,
      requireTLS: false,
      ignoreTLS: false,
      auth: { user: "us@er", pass: "p:ss" },
    });
  });

  it("rejects other schemes and garbage without echoing the URL (it may hold a password)", () => {
    for (const url of [
      "https://relay.example.test",
      "relay.example.test:587",
      "smtp://u:secret@",
    ]) {
      let message = "";
      try {
        parseSmtpUrl({ url, from });
      } catch (error) {
        message = (error as Error).message;
      }
      expect(message).not.toBe("");
      expect(message).not.toContain("secret");
      expect(message).not.toContain("relay.example.test");
    }
  });

  it("allows the insecure opt-out only for local dev (APP_ENV unset or dev)", () => {
    const url = "smtp://127.0.0.1:1025";
    expect(parseSmtpUrl({ url, from, allowInsecure: true })).toMatchObject({
      requireTLS: false,
      ignoreTLS: true,
    });
    expect(parseSmtpUrl({ url, from, allowInsecure: true, appEnv: "dev" })).toMatchObject({
      ignoreTLS: true,
    });
    for (const appEnv of ["staging", "production", "prod", "Staging"]) {
      expect(() => parseSmtpUrl({ url, from, allowInsecure: true, appEnv })).toThrow(
        /EMAIL_SMTP_ALLOW_INSECURE=true is refused/,
      );
    }
  });

  it("refuses the insecure opt-out on smtps://", () => {
    expect(() =>
      parseSmtpUrl({ url: "smtps://relay.example.test", from, allowInsecure: true }),
    ).toThrow(/only applies to smtp:\/\//);
  });

  it("refuses at construction, so a bad boot fails loudly", () => {
    expect(() =>
      createSmtpEmail({
        url: "smtp://127.0.0.1:1025",
        from,
        allowInsecure: true,
        appEnv: "production",
        transport: { sendMail: fakeTransport({ messageId: "x" }) },
      }),
    ).toThrow(/refused/);
  });

  it("reads the config from env and requires both URL and sender", () => {
    expect(
      smtpConfigFromEnv({
        EMAIL_SMTP_URL: " smtp://relay.example.test:587 ",
        EMAIL_FROM: from,
        EMAIL_SMTP_ALLOW_INSECURE: "true",
        APP_ENV: "staging",
      }),
    ).toStrictEqual({
      url: "smtp://relay.example.test:587",
      from,
      allowInsecure: true,
      appEnv: "staging",
    });
    expect(() => smtpConfigFromEnv({ EMAIL_FROM: from })).toThrow(/EMAIL_SMTP_URL and EMAIL_FROM/);
    expect(() => smtpConfigFromEnv({ EMAIL_SMTP_URL: "smtp://r.example.test" })).toThrow(
      /EMAIL_SMTP_URL and EMAIL_FROM/,
    );
  });
});

describe("smtp email driver", () => {
  it("sends from the configured sender and returns the message id", async () => {
    const transport = fakeTransport({ messageId: "<abc@relay>", rejected: [] });
    const result = await driverWith({ sendMail: transport }).send(message);

    expect(result._unsafeUnwrap()).toStrictEqual({ id: "<abc@relay>", route: "live" });
    const [options] = transport.mock.calls[0] as unknown as [Record<string, string>];
    expect(options).toMatchObject({
      from,
      to: "person@example.test",
      subject: "Verify your email",
      text: "Click the link.",
    });
    expect(options.messageId).toMatch(/^<[0-9a-f]{32}@example\.test>$/);
  });

  it("derives the same Message-ID for a retried send (the idempotency key)", async () => {
    const transport = fakeTransport({ messageId: "x" });
    const driver = driverWith({ sendMail: transport });
    expect((await driver.send(message)).isOk()).toBe(true);
    expect((await driver.send(message)).isOk()).toBe(true);
    expect((await driver.send({ ...message, idempotencyKey: "key-2" })).isOk()).toBe(true);
    const ids = transport.mock.calls.map(
      (call) => (call as unknown as [{ messageId: string }])[0].messageId,
    );
    expect(ids[0]).toBe(ids[1]);
    expect(ids[2]).not.toBe(ids[0]);
  });

  it("maps a rejected recipient to declined, not retryable", async () => {
    const result = await driverWith({
      sendMail: fakeTransport({ messageId: "x", rejected: ["person@example.test"] }),
    }).send(message);
    const failure = result._unsafeUnwrapErr();
    expect(failure).toMatchObject({ kind: "declined", boundary: "email", mayHaveSucceeded: false });
    expect(failure.detail).not.toContain("person@example.test");
  });

  it("maps an acceptance without a message id to a retryable server_error", async () => {
    const result = await driverWith({ sendMail: fakeTransport({}) }).send(message);
    expect(result._unsafeUnwrapErr()).toMatchObject({
      kind: "server_error",
      mayHaveSucceeded: true,
    });
  });

  it("never throws: a rejected send becomes a failure, with no recipient in the detail", async () => {
    const result = await driverWith({
      sendMail: fakeTransport(nodemailerError({ code: "ECONNECTION", command: "CONN" })),
    }).send(message);
    const failure = result._unsafeUnwrapErr();
    expect(failure).toMatchObject({
      kind: "server_error",
      boundary: "email",
      mayHaveSucceeded: false,
    });
    expect(JSON.stringify(failure)).not.toContain("person@example.test");
  });
});

describe("classifySmtpError", () => {
  it("5xx is declined, 4xx is a retryable server_error, neither may have succeeded", () => {
    expect(classifySmtpError(nodemailerError({ responseCode: 550 }))).toMatchObject({
      kind: "declined",
      mayHaveSucceeded: false,
    });
    expect(classifySmtpError(nodemailerError({ responseCode: 451 }))).toMatchObject({
      kind: "server_error",
      mayHaveSucceeded: false,
    });
  });

  it("timeouts map to timeout", () => {
    expect(classifySmtpError(nodemailerError({ code: "ETIMEDOUT" }))).toMatchObject({
      kind: "timeout",
      boundary: "email",
    });
  });

  it("no STARTTLS, a bad login and a bad certificate are declined (configuration, not weather)", () => {
    for (const props of [{ code: "ETLS" }, { code: "EAUTH" }, { code: "ESOCKET" }]) {
      expect(classifySmtpError(nodemailerError(props))).toMatchObject({
        kind: "declined",
        mayHaveSucceeded: false,
      });
    }
  });

  it("an OS-level socket failure stays retryable, and may have sent after connecting", () => {
    expect(classifySmtpError(nodemailerError({ code: "ESOCKET", syscall: "read" }))).toMatchObject({
      kind: "server_error",
      mayHaveSucceeded: true,
    });
    expect(
      classifySmtpError(nodemailerError({ code: "ECONNECTION", command: "CONN" })),
    ).toMatchObject({ kind: "server_error", mayHaveSucceeded: false });
  });

  it("does not throw on a non-error value", () => {
    expect(classifySmtpError(undefined)).toMatchObject({ kind: "server_error" });
    expect(classifySmtpError("boom")).toMatchObject({ kind: "server_error" });
  });
});

describe("smtp email driver over a real socket", () => {
  let server: TestSmtpServer | undefined;
  afterEach(async () => {
    await server?.close();
    server = undefined;
  });

  it("delivers to a dev relay when the insecure opt-out is on", async () => {
    server = await startTestSmtpServer();
    const driver = createSmtpEmail({
      url: `smtp://127.0.0.1:${server.port}`,
      from,
      allowInsecure: true,
    });
    const result = await driver.send(message);

    expect(result._unsafeUnwrap().route).toBe("live");
    expect(server.recipients).toStrictEqual(["person@example.test"]);
    expect(server.messages[0]).toContain("Subject: Verify your email");
    expect(server.messages[0]).toContain("Click the link.");
  });

  it("refuses to send in the clear when the relay offers no STARTTLS", async () => {
    server = await startTestSmtpServer();
    const driver = createSmtpEmail({ url: `smtp://127.0.0.1:${server.port}`, from });
    const result = await driver.send(message);

    expect(result._unsafeUnwrapErr()).toMatchObject({ kind: "declined", mayHaveSucceeded: false });
    // Nothing about the message ever crossed the wire.
    expect(server.recipients).toStrictEqual([]);
    expect(server.messages).toStrictEqual([]);
    expect(server.commands.some((line) => /^(MAIL|RCPT|DATA|AUTH)/i.test(line))).toBe(false);
  });

  it("maps a relay's 5xx on the recipient to declined", async () => {
    server = await startTestSmtpServer({ rejectRcpt: () => "550 5.1.1 no such user" });
    const driver = createSmtpEmail({
      url: `smtp://127.0.0.1:${server.port}`,
      from,
      allowInsecure: true,
    });
    const failure = (await driver.send(message))._unsafeUnwrapErr();
    expect(failure).toMatchObject({ kind: "declined", mayHaveSucceeded: false });
  });

  it("times out on a relay that accepts the connection and never greets", async () => {
    const open = new Set<Socket>();
    const silent = createServer((socket) => {
      open.add(socket);
    });
    await new Promise<void>((resolve) => silent.listen(0, "127.0.0.1", resolve));
    const port = (silent.address() as { port: number }).port;
    try {
      const driver = createSmtpEmail({
        url: `smtp://127.0.0.1:${port}`,
        from,
        allowInsecure: true,
        timeoutMs: 200,
      });
      const started = Date.now();
      const result = await driver.send(message);
      expect(result._unsafeUnwrapErr()).toMatchObject({ kind: "timeout", boundary: "email" });
      expect(Date.now() - started).toBeLessThan(5_000);
    } finally {
      for (const socket of open) socket.destroy();
      await new Promise((resolve) => silent.close(resolve));
    }
  });
});
