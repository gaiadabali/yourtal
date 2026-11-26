/**
 * Realistic header samples for the classify tests. Values are what JMAP
 * `asText` returns: unfolded (CRLF removed, the folding tab kept), trimmed.
 * The authserv-id and the two STALWART_* samples are verbatim from the live
 * Stalwart v1.2.1 on Helios (T0, U5, 2026-11-27); the builders below follow
 * that layout.
 */
import type { JmapSenderFields } from "../jmap-input";
import type { ClassifyConfig } from "../sender-checks";
import { parseOwnDomains } from "../domains";

export const AUTHSERV = "mail.yourtal.gaiada.com";

export const CONFIG: ClassifyConfig = {
  authservId: AUTHSERV,
  ownOrgDomains: parseOwnDomains(undefined),
};

/** Relay mail signed by our opendkim: DMARC passes for yourtal.gaiada.com. */
export const STALWART_RELAY_PASS =
  "mail.yourtal.gaiada.com;	dkim=pass header.d=yourtal.gaiada.com header.s=helios header.b=SlIrtC/r;	spf=none (mail.yourtal.gaiada.com: no SPF records found for postmaster@srv1700943.hstgr.cloud) smtp.helo=srv1700943.hstgr.cloud;	spf=fail (mail.yourtal.gaiada.com: domain of no-reply@yourtal.gaiada.com does not designate 172.17.0.1 as permitted sender) smtp.mailfrom=no-reply@yourtal.gaiada.com;	iprev=permerror (dns record not found) policy.iprev=172.17.0.1;	dmarc=pass header.from=yourtal.gaiada.com policy.dmarc=none";

/** An external probe without SPF, DKIM or a DMARC record. */
export const STALWART_PROBE_NONE =
  "mail.yourtal.gaiada.com;	spf=none (mail.yourtal.gaiada.com: no SPF records found for postmaster@server-f.test) smtp.helo=server-f.test;	spf=none (mail.yourtal.gaiada.com: no SPF records found for probe@server-f.gaiada.com) smtp.mailfrom=probe@server-f.gaiada.com;	iprev=pass policy.iprev=72.62.127.204;	dmarc=none header.from=server-f.gaiada.com policy.dmarc=none";

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
