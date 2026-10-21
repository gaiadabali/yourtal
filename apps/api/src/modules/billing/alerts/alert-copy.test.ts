import { describe, expect, it } from "vitest";
import { alertEmail } from "./alert-copy";
import type { AlertFacts } from "./alert-copy";

const receipts = (over: Partial<AlertFacts>): AlertFacts => ({
  kind: "package",
  thresholdPct: 80,
  usedPoints: 800,
  totalPoints: 1000,
  campaignTitle: null,
  programme: "receipts",
  ...over,
});

describe("receipt package alert wording (2.10.b, F127)", () => {
  it("50% and 80% name the percentage and the points left, en-AU", () => {
    const email = alertEmail("en-AU", receipts({}));
    expect(email.subject).toBe("Your receipt points package is 80% used");
    expect(email.body).toBe(
      "Your receipt points package is 80% used: 200 points are left. Buy another receipt package in Studio Billing so receipts keep earning.",
    );
    expect(alertEmail("en-AU", receipts({ thresholdPct: 50, usedPoints: 500 })).body).toContain(
      "50% used: 500 points are left",
    );
  });

  it("50% and 80% in id-ID", () => {
    const email = alertEmail("id-ID", receipts({}));
    expect(email.subject).toBe("Paket poin struk Anda sudah terpakai 80%");
    expect(email.body).toBe(
      "Paket poin struk Anda sudah terpakai 80%: tersisa 200 poin. Beli paket struk lain di Penagihan Studio agar struk di aplikasi Anda terus mendapatkan poin.",
    );
  });

  it("100% with no other package with room says receipts stopped", () => {
    const facts = receipts({ thresholdPct: 100, usedPoints: 1000, nextPackagePoints: null });
    expect(alertEmail("en-AU", facts)).toEqual({
      subject: "Your receipt points package is used up",
      body: "Your receipt points package is used up, so receipts in your app have stopped earning YourTal points. Buy another receipt package in Studio Billing.",
    });
    expect(alertEmail("id-ID", facts)).toEqual({
      subject: "Paket poin struk Anda sudah habis",
      body: "Paket poin struk Anda sudah habis, jadi struk di aplikasi Anda berhenti mendapatkan poin YourTal. Beli paket struk lain di Penagihan Studio.",
    });
    // Unspecified means the same as none.
    const { nextPackagePoints: _omitted, ...unspecified } = facts;
    expect(alertEmail("en-AU", unspecified)).toEqual(alertEmail("en-AU", facts));
  });

  it("100% with another package names it and its points left", () => {
    const facts = receipts({ thresholdPct: 100, usedPoints: 1000, nextPackagePoints: 1500 });
    expect(alertEmail("en-AU", facts)).toEqual({
      subject: "A receipt points package is used up",
      body: "A receipt points package is used up. Receipts now earn from your next package (1,500 points left).",
    });
    expect(alertEmail("id-ID", facts).body).toBe(
      "Sebuah paket poin struk sudah habis. Struk kini mendapatkan poin dari paket Anda berikutnya (tersisa 1.500 poin).",
    );
  });

  it("an ordinary package and a campaign keep today's wording", () => {
    expect(alertEmail("en-AU", receipts({ programme: null })).subject).toBe(
      "Your points package is 80% used",
    );
    const { programme: _none, ...plain } = receipts({});
    expect(alertEmail("en-AU", { ...plain, kind: "campaign" }).subject).toBe(
      'Campaign "Your campaign" has used 80% of its budget',
    );
  });
});
