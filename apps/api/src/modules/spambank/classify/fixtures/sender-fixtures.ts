/**
 * Realistic header samples for the classify tests. Values are what JMAP
 * `asText` returns: unfolded, trimmed. The authserv-id and the exact shape of
 * Stalwart's own field are [UNVERIFIED] until T0 records U5 in
 * spambank/stalwart-fixtures/; swap them in here when it does.
 */
import type { JmapSenderFields } from "../jmap-input";
import type { ClassifyConfig } from "../sender-checks";
import { parseOwnDomains } from "../domains";

export const AUTHSERV = "mail.yourtal.gaiada.com";

export const CONFIG: ClassifyConfig = {
  authservId: AUTHSERV,
  ownOrgDomains: parseOwnDomains(undefined),
};

/** Stalwart-style field (mail-auth crate layout) for a DMARC-aligned sender. */
export function oursPass(fromDomain: string, mailFrom = `bounce-7781@em.${fromDomain}`): string {
  return (
    `${AUTHSERV}; dkim=pass header.d=${fromDomain} header.s=s1 header.b=kV3x9Qz+; ` +
    `spf=pass (${AUTHSERV}: domain of ${mailFrom} designates 198.2.180.10 as permitted sender) ` +
    `smtp.mailfrom=${mailFrom} smtp.helo=mail180-10.suw21.mcsv.net; ` +
    `dmarc=pass header.from=${fromDomain} policy.dmarc=reject`
  );
}

export function oursDmarc(result: string, headerFrom: string): string {
  return (
    `${AUTHSERV}; dkim=none; spf=softfail (${AUTHSERV}: domain of x@${headerFrom} does not ` +
    `designate 203.0.113.9 as permitted sender) smtp.mailfrom=x@${headerFrom}; ` +
    `dmarc=${result} header.from=${headerFrom} policy.dmarc=none`
  );
}

/** Gmail's own field, as seen on mail forwarded from a Gmail account. */
export function gmailPass(fromDomain: string): string {
  return (
    `mx.google.com; dkim=pass header.i=@${fromDomain} header.s=google header.b=AbCdEf12; ` +
    `spf=pass (google.com: domain of bounce@em.${fromDomain} designates 198.2.128.1 as ` +
    `permitted sender) smtp.mailfrom=bounce@em.${fromDomain}; ` +
    `dmarc=pass (p=REJECT sp=REJECT dis=NONE) header.from=${fromDomain}`
  );
}

/** Exchange Online writes no authserv-id at all. */
export function microsoftPass(fromDomain: string): string {
  return (
    `spf=pass (sender IP is 40.107.22.51) smtp.mailfrom=${fromDomain}; dkim=pass ` +
    `(signature was verified) header.d=${fromDomain};dmarc=pass action=none ` +
    `header.from=${fromDomain};compauth=pass reason=100`
  );
}

/** A Mailchimp-style newsletter that passes every check. */
export function newsletter(overrides: Partial<JmapSenderFields> = {}): JmapSenderFields {
  return {
    from: [{ name: "Brand News", email: "news@brand.com.au" }],
    replyTo: null,
    bodyStructure: { type: "multipart/alternative" },
    "header:From:asAddresses:all": [[{ name: "Brand News", email: "news@brand.com.au" }]],
    "header:Authentication-Results:asText:all": [oursPass("brand.com.au")],
    "header:List-Unsubscribe:asText:all": [
      "<https://brand.us21.list-manage.com/unsubscribe?u=abc&id=def>, <mailto:unsub-abc@us21.mcsv.net>",
    ],
    "header:List-Unsubscribe:asURLs": [
      "https://brand.us21.list-manage.com/unsubscribe?u=abc&id=def",
      "mailto:unsub-abc@us21.mcsv.net",
    ],
    "header:List-Id:asText:all": ["Brand <abc123.list-id.mcsv.net>"],
    "header:Precedence:asText:all": ["bulk"],
    "header:Auto-Submitted:asText:all": [],
    "header:X-Autoreply:asText:all": [],
    "header:X-Autorespond:asText:all": [],
    "header:X-Auto-Response-Suppress:asText:all": [],
    "header:Return-Path:asText:all": ["<bounce-7781@em.brand.com.au>"],
    ...overrides,
  };
}

/** A newsletter from `email` on `domain`, authenticated for that domain. */
export function newsletterFrom(
  email: string,
  domain = email.split("@")[1] ?? "",
): JmapSenderFields {
  return newsletter({
    from: [{ name: "Sender", email }],
    "header:From:asAddresses:all": [[{ name: "Sender", email }]],
    "header:Authentication-Results:asText:all": [oursPass(domain)],
  });
}
