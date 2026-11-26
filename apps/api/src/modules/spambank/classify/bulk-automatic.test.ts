import { describe, expect, it } from "vitest";
import { type AutomaticHeaders, automaticReason } from "./automatic";
import { type BulkHeaders, hasBulkMarkers, isBulkForFiling } from "./bulk";
import { hasQuoteInComment, stripComments } from "./header-values";

describe("bulk markers (§4.6 check 3) and the Junk rule (§4.2)", () => {
  const cases: [string, BulkHeaders, boolean, boolean][] = [
    ["List-Unsubscribe only", { listUnsubscribe: "<https://x.example/u>" }, true, true],
    ["List-Unsubscribe mailto", { listUnsubscribe: ["<mailto:u@x.example>"] }, true, true],
    ["List-Id only", { listId: "Announce <announce.lists.example.org>" }, true, true],
    ["Precedence: bulk", { precedence: "bulk" }, true, true],
    ["Precedence: list", { precedence: "List" }, true, true],
    ["Precedence: bulk with a comment", { precedence: "bulk (newsletter)" }, true, true],
    ["Precedence: junk files but is no marker", { precedence: "junk" }, false, true],
    ["Precedence: first-class", { precedence: "first-class" }, false, false],
    ["blank List-Id", { listId: "  " }, false, false],
    ["a second Precedence instance counts", { precedence: ["normal", "bulk"] }, true, true],
    ["person-to-person mail", {}, false, false],
    [
      "absent headers as JMAP :all",
      { listUnsubscribe: [], listId: [], precedence: [] },
      false,
      false,
    ],
  ];
  it.each(cases)("%s", (_name, h, markers, filing) => {
    expect(hasBulkMarkers(h)).toBe(markers);
    expect(isBulkForFiling(h)).toBe(filing);
  });
});

describe("automaticReason (§4.6 check 4)", () => {
  const cases: [string, AutomaticHeaders, ReturnType<typeof automaticReason>][] = [
    [
      "plain newsletter",
      { returnPath: "<bounce-1@em.brand.com>", contentType: "multipart/alternative" },
      null,
    ],
    ["Auto-Submitted: no", { autoSubmitted: "no" }, null],
    ["Auto-Submitted: No (person)", { autoSubmitted: "No (sent by a person)" }, null],
    ["Auto-Submitted: auto-generated", { autoSubmitted: "auto-generated" }, "auto_submitted"],
    ["Auto-Submitted: auto-replied", { autoSubmitted: "auto-replied" }, "auto_submitted"],
    [
      "Auto-Submitted with parameters",
      { autoSubmitted: 'auto-replied; owner-email="x@y.com"' },
      "auto_submitted",
    ],
    [
      "a later `no` cannot hide auto-replied",
      { autoSubmitted: ["auto-replied", "no"] },
      "auto_submitted",
    ],
    ["unreadable Auto-Submitted", { autoSubmitted: "no (broken" }, "auto_submitted"],
    ["X-Autoreply: yes", { xAutoreply: "yes" }, "x_autoreply"],
    ["X-Autorespond present", { xAutorespond: "Out of office" }, "x_autorespond"],
    ["X-Auto-Response-Suppress: All", { xAutoResponseSuppress: "All" }, "auto_response_suppress"],
    [
      "X-Auto-Response-Suppress list with AutoReply",
      { xAutoResponseSuppress: "DR, RN, NRN, OOF, AutoReply" },
      "auto_response_suppress",
    ],
    ["X-Auto-Response-Suppress: OOF only", { xAutoResponseSuppress: "OOF" }, null],
    ["Precedence: auto_reply", { precedence: "auto_reply" }, "precedence_auto_reply"],
    ["Return-Path: <>", { returnPath: "<>" }, "null_return_path"],
    ["Return-Path: < > with a comment", { returnPath: "< > (null sender)" }, "null_return_path"],
    [
      "multipart/report DSN",
      { contentType: "multipart/report; report-type=delivery-status" },
      "report",
    ],
    ["ARF complaint", { contentType: "Multipart/Report" }, "report"],
    ["bare delivery-status", { contentType: "message/delivery-status" }, "report"],
  ];
  it.each(cases)("%s", (_name, h, reason) => {
    expect(automaticReason(h)).toBe(reason);
  });
});

describe("comment handling", () => {
  it("strips nested comments and keeps quoted parentheses", () => {
    expect(stripComments('a (b (c) d) "e (f)" g')).toBe('a   "e (f)" g');
    expect(stripComments("a (b")).toBeNull();
    expect(stripComments("a ) b")).toBeNull();
    expect(stripComments('a "b')).toBeNull();
    expect(stripComments("a (b \\) c) d")).toBe("a   d");
  });

  it("spots a quote inside a comment only", () => {
    expect(hasQuoteInComment('x (a "b" c) y')).toBe(true);
    expect(hasQuoteInComment('x "(a)" y (b)')).toBe(false);
  });
});
