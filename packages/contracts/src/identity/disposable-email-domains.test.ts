import { describe, expect, it } from "vitest";
import { DISPOSABLE_EMAIL_DOMAINS, isDisposableEmail } from "./disposable-email-domains";

describe("isDisposableEmail (F126)", () => {
  it("matches every listed domain exactly", () => {
    expect(DISPOSABLE_EMAIL_DOMAINS).toHaveLength(20);
    for (const domain of DISPOSABLE_EMAIL_DOMAINS) {
      expect(isDisposableEmail(`someone@${domain}`)).toBe(true);
    }
  });

  it("ignores case and surrounding space", () => {
    expect(isDisposableEmail("Someone@MailInator.COM")).toBe(true);
    expect(isDisposableEmail("someone@Yopmail.com ")).toBe(true);
  });

  it("matches any subdomain of a listed domain", () => {
    expect(isDisposableEmail("x@inbox.mailinator.com")).toBe(true);
    expect(isDisposableEmail("x@a.b.guerrillamail.net")).toBe(true);
  });

  it("does not match a look-alike or a different domain", () => {
    expect(isDisposableEmail("x@notmailinator.com")).toBe(false);
    expect(isDisposableEmail("x@mailinator.com.au")).toBe(false);
    expect(isDisposableEmail("x@mailinator.example.test")).toBe(false);
    expect(isDisposableEmail("x@gmail.com")).toBe(false);
  });

  it("keeps the demo domains allowed", () => {
    expect(isDisposableEmail("viewer@demo.yourtal.test")).toBe(false);
    expect(isDisposableEmail("viewer@example.test")).toBe(false);
  });

  it("reads only the domain after the last @", () => {
    expect(isDisposableEmail("mailinator.com@gmail.com")).toBe(false);
    expect(isDisposableEmail("no-at-sign")).toBe(false);
  });
});
