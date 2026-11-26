import { describe, expect, it } from "vitest";
import { neverReplyReason, normalizeLocalPart } from "./never-reply";

describe("neverReplyReason (§4.6 check 5)", () => {
  it.each([
    ["noreply", "contains_noreply"],
    ["no-reply", "contains_noreply"],
    ["No_Reply", "contains_noreply"],
    ["no.reply", "contains_noreply"],
    ["NOREPLY+abc123", "contains_noreply"],
    ["accounts-noreply", "contains_noreply"],
    ["mail.noreply.au", "contains_noreply"],
    ['"no reply"', "contains_noreply"],
    ["donotreply", "contains_noreply"],
    ["do-not-reply", "contains_noreply"],
    ["Do_Not.Reply", "contains_noreply"],
    ["do-not-respond", "contains_noreply"],
    ["no-response", "contains_noreply"],
    ["mailer-daemon", "system_prefix"],
    ["MAILER-DAEMON", "system_prefix"],
    ["mailer_daemon+x", "system_prefix"],
    ["postmaster", "system_prefix"],
    ["bounce", "system_prefix"],
    ["bounces+SRS=abc=12", "system_prefix"],
    ["bounce-mc.us21_1234.5678-news=brand.com", "system_prefix"],
    ["abuse", "system_prefix"],
    ["listserv", "system_prefix"],
    ["majordomo", "system_prefix"],
    ["nobody", "system_prefix"],
    ["root", "system_prefix"],
    ["owner-announce", "list_owner"],
    ["announce-request", "list_request"],
    ["announce-request+x", "list_request"],
    ["+tagonly", "empty"],
  ])("%s → %s", (local, reason) => {
    expect(neverReplyReason(local)).toBe(reason);
  });

  it.each(["news", "hello", "team", "marketing", "offers", "info", "reply", "bouncer-news"])(
    "%s is replyable",
    (local) => {
      // `bouncer-news` starts with `bounce`: refused, documenting the deliberate over-match.
      expect(neverReplyReason(local)).toBe(local === "bouncer-news" ? "system_prefix" : null);
    },
  );

  it("normalises as §4.6 says", () => {
    expect(normalizeLocalPart("No.Reply-Team_AU+promo")).toBe("noreplyteamau");
  });
});
