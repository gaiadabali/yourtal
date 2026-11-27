import { describe, expect, it } from "vitest";
import { blocklistQueries, interpret, reversedIp } from "./blocklist";
import { pauseReasonFor } from "./pause";
import { classifyReplyMessage, reportType } from "./reply-report";

const DOMAIN = "spambank.yourtal.gaiada.com";
const ID = "0b9d7c2e-1111-4222-8333-944455556666";
const OURS = `autoreply-${ID}@${DOMAIN}`;

function dsn(action: string, includeOurs = true): string {
  return [
    "Return-Path: <>",
    "From: Mail Delivery System <MAILER-DAEMON@mx.brand.com.au>",
    `To: reply@${DOMAIN}`,
    "Subject: Undelivered Mail Returned to Sender",
    "Auto-Submitted: auto-replied",
    "Content-Type: multipart/report; report-type=delivery-status;",
    '\tboundary="b1"',
    "",
    "--b1",
    "Content-Type: text/plain",
    "",
    "I'm sorry to have to inform you that your message could not be delivered.",
    "--b1",
    "Content-Type: message/delivery-status",
    "",
    "Reporting-MTA: dns; mx.brand.com.au",
    "",
    "Final-Recipient: rfc822; news@brand.com.au",
    `Action: ${action}`,
    "Status: 5.1.1",
    "--b1",
    "Content-Type: text/rfc822-headers",
    "",
    `Message-ID: <${includeOurs ? OURS : "someone-else@example.com"}>`,
    "--b1--",
    "",
  ].join("\r\n");
}

function arf(includeOurs: boolean): string {
  return [
    "From: feedback@fbl.example.net",
    `To: abuse@${DOMAIN}`,
    "Subject: Complaint",
    'Content-Type: multipart/report; report-type="feedback-report"; boundary="f"',
    "",
    "--f",
    "Content-Type: message/feedback-report",
    "",
    "Feedback-Type: abuse",
    "--f",
    "Content-Type: message/rfc822",
    "",
    includeOurs ? `Message-ID: <${OURS}>` : "Message-ID: <x@y>",
    "--f--",
  ].join("\r\n");
}

describe("classifyReplyMessage", () => {
  it("counts a failed DSN that names our reply as a bounce", () => {
    const report = classifyReplyMessage(dsn("failed"), DOMAIN);
    expect(report).toMatchObject({ kind: "bounce", autoreplyId: ID, detail: "dsn_failed" });
  });

  it("ignores a delay, and a failure that names nothing of ours", () => {
    expect(classifyReplyMessage(dsn("delayed"), DOMAIN).kind).toBe("ignored");
    expect(classifyReplyMessage(dsn("failed", false), DOMAIN)).toMatchObject({
      kind: "ignored",
      detail: "dsn_not_ours",
    });
  });

  it("reads an ARF report as a complaint, with or without our id", () => {
    expect(classifyReplyMessage(arf(true), DOMAIN)).toMatchObject({
      kind: "complaint",
      autoreplyId: ID,
    });
    expect(classifyReplyMessage(arf(false), DOMAIN)).toMatchObject({
      kind: "complaint",
      autoreplyId: null,
    });
  });

  it("counts a non-standard bounce only when it names our reply and says it failed", () => {
    const raw = [
      "Return-Path: <>",
      "From: postmaster@mail.brand.com.au",
      "Subject: Delivery has failed to these recipients",
      "",
      `Original message: ${OURS}`,
    ].join("\r\n");
    expect(classifyReplyMessage(raw, DOMAIN)).toMatchObject({ kind: "bounce", autoreplyId: ID });
    expect(classifyReplyMessage(raw.replace(OURS, "x@y"), DOMAIN).kind).toBe("ignored");
  });

  it("ignores out-of-office and list mail", () => {
    const ooo = [
      "From: Sam <sam@brand.com.au>",
      "Auto-Submitted: auto-replied",
      `In-Reply-To: <${OURS}>`,
      "Subject: Out of office",
      "",
      "Back Monday.",
    ].join("\r\n");
    expect(classifyReplyMessage(ooo, DOMAIN)).toMatchObject({
      kind: "ignored",
      detail: "auto_submitted",
    });
    const list = "From: news@x.com\r\nList-Id: <l.x.com>\r\n\r\nhi";
    expect(classifyReplyMessage(list, DOMAIN).kind).toBe("ignored");
  });

  it("treats a person writing back as an answer, with the reply they answered", () => {
    const raw = [
      "From: Sam Lee <Sam@Mail.Brand.com.au>",
      `In-Reply-To: <${OURS}>`,
      "Subject: Re: Your email reached a Spambank inbox",
      "Auto-Submitted: no",
      "",
      "Please stop.",
    ].join("\r\n");
    expect(classifyReplyMessage(raw, DOMAIN)).toMatchObject({
      kind: "answer",
      autoreplyId: ID,
      fromAddress: "Sam@mail.brand.com.au",
      fromOrgDomain: "brand.com.au",
    });
  });

  it("reads report-type in its quoted and bare forms", () => {
    expect(reportType('multipart/report; report-type="feedback-report"')).toBe("feedback-report");
    expect(reportType("Multipart/Report; Report-Type=Delivery-Status")).toBe("delivery-status");
    expect(reportType("multipart/mixed")).toBeNull();
  });
});

describe("auto-pause thresholds", () => {
  it("pauses on 2 complaints, or 10+ bounces that are also 10% of sent", () => {
    expect(pauseReasonFor({ sent: 100, bounces: 0, complaints: 2 })).toContain("complaints");
    expect(pauseReasonFor({ sent: 100, bounces: 10, complaints: 0 })).toContain("bounces");
    expect(pauseReasonFor({ sent: 101, bounces: 10, complaints: 1 })).toBeNull();
    expect(pauseReasonFor({ sent: 5, bounces: 9, complaints: 1 })).toBeNull();
    expect(pauseReasonFor({ sent: 0, bounces: 0, complaints: 0 })).toBeNull();
  });
});

describe("blocklist answers", () => {
  it("builds the §4.6 queries", () => {
    expect(reversedIp("187.77.116.133")).toBe("133.116.77.187");
    expect(
      blocklistQueries(["187.77.116.133", "not-an-ip"], ["yourtal.gaiada.com"]).map((q) => q.name),
    ).toEqual([
      "133.116.77.187.zen.spamhaus.org",
      "133.116.77.187.bl.spamcop.net",
      "yourtal.gaiada.com.dbl.spamhaus.org",
    ]);
  });

  it("reads clean, listed, refused and odd answers per list", () => {
    expect(interpret("zen.spamhaus.org", { status: "nxdomain" }).result).toBe("clean");
    expect(
      interpret("zen.spamhaus.org", { status: "found", addresses: ["127.0.0.4"] }).result,
    ).toBe("listed");
    expect(
      interpret("zen.spamhaus.org", { status: "found", addresses: ["127.255.255.254"] }).result,
    ).toBe("refused");
    expect(
      interpret("dbl.spamhaus.org", { status: "found", addresses: ["127.0.1.2"] }).result,
    ).toBe("listed");
    expect(
      interpret("dbl.spamhaus.org", { status: "found", addresses: ["127.255.255.252"] }).result,
    ).toBe("refused");
    expect(interpret("bl.spamcop.net", { status: "found", addresses: ["127.0.0.2"] }).result).toBe(
      "listed",
    );
    expect(interpret("zen.spamhaus.org", { status: "found", addresses: ["10.0.0.1"] }).result).toBe(
      "error",
    );
    expect(interpret("bl.spamcop.net", { status: "error", detail: "ETIMEOUT" }).result).toBe(
      "error",
    );
  });
});
