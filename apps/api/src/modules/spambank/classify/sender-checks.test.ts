import { describe, expect, it } from "vitest";
import {
  CONFIG,
  STALWART_PROBE_NONE,
  STALWART_RELAY_PASS,
  gmailPass,
  newsletter,
  newsletterFrom,
  oursDmarc,
  oursPass,
} from "./fixtures/sender-fixtures";
import { JMAP_SENDER_PROPERTIES, type JmapSenderFields, senderInputFromJmap } from "./jmap-input";
import { classifySender } from "./sender-checks";

function classify(e: JmapSenderFields) {
  return classifySender(senderInputFromJmap(e), CONFIG);
}

/** [name, message, auto-reply outcome, lead outcome] — outcome = target / org domain, or the skip code. */
const CASES: [string, JmapSenderFields, string, string][] = [
  ["qualifying newsletter", newsletter(), "news@brand.com.au", "brand.com.au"],
  [
    "List-Id only",
    newsletter({
      "header:List-Unsubscribe:asText:all": [],
      "header:List-Unsubscribe:asURLs": null,
      "header:Precedence:asText:all": [],
    }),
    "news@brand.com.au",
    "brand.com.au",
  ],
  [
    "Precedence: list only",
    newsletter({
      "header:List-Unsubscribe:asText:all": [],
      "header:List-Unsubscribe:asURLs": null,
      "header:List-Id:asText:all": [],
      "header:Precedence:asText:all": ["list"],
    }),
    "news@brand.com.au",
    "brand.com.au",
  ],
  [
    "List-Unsubscribe known only from asURLs",
    newsletter({
      "header:List-Unsubscribe:asText:all": undefined,
      "header:List-Id:asText:all": [],
      "header:Precedence:asText:all": [],
    }),
    "news@brand.com.au",
    "brand.com.au",
  ],
  [
    "no bulk markers (a person)",
    newsletter({
      "header:List-Unsubscribe:asText:all": [],
      "header:List-Unsubscribe:asURLs": null,
      "header:List-Id:asText:all": [],
      "header:Precedence:asText:all": [],
    }),
    "not_bulk",
    "not_bulk",
  ],
  [
    "forged From, no AR of ours",
    newsletter({ "header:Authentication-Results:asText:all": [gmailPass("brand.com.au")] }),
    "unauthenticated",
    "unauthenticated",
  ],
  [
    "DMARC pass for another domain",
    newsletter({ "header:Authentication-Results:asText:all": [oursPass("brandmail.net")] }),
    "unauthenticated",
    "unauthenticated",
  ],
  [
    "dmarc=none",
    newsletter({ "header:Authentication-Results:asText:all": [oursDmarc("none", "brand.com.au")] }),
    "unauthenticated",
    "unauthenticated",
  ],
  [
    "two From header fields",
    newsletter({
      "header:From:asAddresses:all": [[{ email: "a@evil.com" }], [{ email: "news@brand.com.au" }]],
    }),
    "unauthenticated",
    "unauthenticated",
  ],
  [
    "Auto-Submitted: auto-generated",
    newsletter({ "header:Auto-Submitted:asText:all": ["auto-generated"] }),
    "auto_or_bounce",
    "auto_or_bounce",
  ],
  [
    "Return-Path: <>",
    newsletter({ "header:Return-Path:asText:all": ["<>"] }),
    "auto_or_bounce",
    "auto_or_bounce",
  ],
  [
    "multipart/report",
    newsletter({ bodyStructure: { type: "multipart/report" } }),
    "auto_or_bounce",
    "auto_or_bounce",
  ],
  [
    "X-Auto-Response-Suppress: All",
    newsletter({ "header:X-Auto-Response-Suppress:asText:all": ["All"] }),
    "auto_or_bounce",
    "auto_or_bounce",
  ],
  [
    "asText fallback when :all was not fetched",
    newsletter({
      "header:Auto-Submitted:asText:all": undefined,
      "header:Auto-Submitted:asText": "auto-replied",
    }),
    "auto_or_bounce",
    "auto_or_bounce",
  ],
  [
    "noreply@ still counts as a lead",
    newsletterFrom("noreply@brand.com.au", "brand.com.au"),
    "noreply_address",
    "brand.com.au",
  ],
  [
    "no-reply+tag@",
    newsletterFrom("No-Reply+Promo@brand.com.au", "brand.com.au"),
    "noreply_address",
    "brand.com.au",
  ],
  [
    "bounces@",
    newsletterFrom("bounces@brand.com.au", "brand.com.au"),
    "noreply_address",
    "brand.com.au",
  ],
  [
    "co.uk sender",
    newsletterFrom("offers@mail.shop.co.uk", "mail.shop.co.uk"),
    "offers@mail.shop.co.uk",
    "shop.co.uk",
  ],
  ["co.id sender", newsletterFrom("promo@toko.co.id"), "promo@toko.co.id", "toko.co.id"],
  [
    "com.au subdomain sender",
    newsletterFrom("hello@em.brand.com.au", "em.brand.com.au"),
    "hello@em.brand.com.au",
    "brand.com.au",
  ],
  ["own domain (gaiada.com)", newsletterFrom("news@gaiada.com"), "own_domain", "own_domain"],
  [
    "own domain (our reply address)",
    newsletterFrom("reply@spambank.yourtal.gaiada.com", "spambank.yourtal.gaiada.com"),
    "own_domain",
    "own_domain",
  ],
  [
    "own domain (freetaxreturns.com.au)",
    newsletterFrom("hello@freetaxreturns.com.au"),
    "own_domain",
    "own_domain",
  ],
  [
    "freemail (gmail.com list)",
    newsletterFrom("club.newsletter@gmail.com"),
    "freemail",
    "freemail",
  ],
  ["freemail (yahoo.co.id)", newsletterFrom("promo@yahoo.co.id"), "freemail", "freemail"],
  [
    "Reply-To on From's org domain is the target",
    newsletter({ replyTo: [{ email: "Hello@Support.Brand.com.au" }] }),
    "Hello@support.brand.com.au",
    "brand.com.au",
  ],
  [
    "Reply-To on another domain is ignored",
    newsletter({ replyTo: [{ email: "replies@esp-mail.net" }] }),
    "news@brand.com.au",
    "brand.com.au",
  ],
  [
    "Reply-To on a freemail domain is ignored",
    newsletter({ replyTo: [{ email: "owner@gmail.com" }] }),
    "news@brand.com.au",
    "brand.com.au",
  ],
  [
    "two Reply-To addresses: From is used",
    newsletter({ replyTo: [{ email: "a@brand.com.au" }, { email: "b@brand.com.au" }] }),
    "news@brand.com.au",
    "brand.com.au",
  ],
  [
    "noreply Reply-To on the same domain blocks",
    newsletter({ replyTo: [{ email: "do-not-reply@brand.com.au" }] }),
    "noreply_address",
    "brand.com.au",
  ],
  [
    "quoted From local part cannot be an envelope",
    newsletterFrom('"news desk"@brand.com.au', "brand.com.au"),
    "invalid_address",
    "brand.com.au",
  ],
];

describe("classifySender: checks 2–7 and the lead rule, from JMAP fields", () => {
  it.each(CASES)("%s", (_name, email, autoreply, lead) => {
    const r = classify(email);
    expect(r.autoreply.eligible ? r.autoreply.target : r.autoreply.code).toBe(autoreply);
    expect(r.lead.eligible ? r.lead.orgDomain : r.lead.code).toBe(lead);
  });

  it("live samples: relay mail passes DMARC, is never replied to and is no lead; the probe fails", () => {
    const real = classify(
      newsletter({
        from: [{ email: "no-reply@yourtal.gaiada.com" }],
        "header:From:asAddresses:all": [[{ email: "no-reply@yourtal.gaiada.com" }]],
        "header:Authentication-Results:asText:all": [STALWART_RELAY_PASS],
      }),
    );
    expect(real).toMatchObject({ dmarcPass: true, fromOrgDomain: "gaiada.com" });
    // Check 5 (no-reply@) comes before check 6; the lead rule skips 5 and stops at 6.
    expect(real.autoreply).toMatchObject({ eligible: false, code: "noreply_address" });
    expect(real.lead).toMatchObject({ eligible: false, code: "own_domain" });
    const probe = classify(
      newsletter({
        from: [{ email: "probe@server-f.gaiada.com" }],
        "header:From:asAddresses:all": [[{ email: "probe@server-f.gaiada.com" }]],
        "header:Authentication-Results:asText:all": [STALWART_PROBE_NONE],
      }),
    );
    expect(probe).toMatchObject({ dmarcPass: false });
    expect(probe.autoreply).toMatchObject({ eligible: false, code: "unauthenticated" });
  });

  it("reports the row facts for ingested_message", () => {
    const r = classify(newsletter());
    expect(r).toMatchObject({
      dmarcPass: true,
      fromAddress: "news@brand.com.au",
      fromOrgDomain: "brand.com.au",
      bulk: true,
      hasListUnsubscribe: true,
      autoreply: { eligible: true, target: "news@brand.com.au", orgDomain: "brand.com.au" },
    });
  });

  it("runs the checks in §4.6 order (first failure wins)", () => {
    // Unauthenticated AND automatic AND noreply: check 2 is reported.
    const r = classify(
      newsletter({
        from: [{ email: "noreply@brand.com.au" }],
        "header:Authentication-Results:asText:all": [],
        "header:Auto-Submitted:asText:all": ["auto-generated"],
      }),
    );
    expect(r.autoreply).toMatchObject({
      eligible: false,
      code: "unauthenticated",
      detail: "no_trusted_field",
    });
  });

  it("keeps the org domain for an unauthenticated sender (ingested_message.from_org_domain)", () => {
    const r = classify(newsletter({ "header:Authentication-Results:asText:all": [] }));
    expect(r).toMatchObject({ dmarcPass: false, fromOrgDomain: "brand.com.au" });
  });

  it("files Precedence: junk mail as bulk without making it replyable", () => {
    const r = classify(
      newsletter({
        "header:List-Unsubscribe:asText:all": [],
        "header:List-Unsubscribe:asURLs": null,
        "header:List-Id:asText:all": [],
        "header:Precedence:asText:all": ["junk"],
      }),
    );
    expect(r.bulk).toBe(true);
    expect(r.autoreply).toMatchObject({ eligible: false, code: "not_bulk" });
  });

  it("lists every JMAP property the adapter reads", () => {
    expect(JMAP_SENDER_PROPERTIES).toContain("header:Authentication-Results:asText:all");
    expect(new Set(JMAP_SENDER_PROPERTIES).size).toBe(JMAP_SENDER_PROPERTIES.length);
  });
});
