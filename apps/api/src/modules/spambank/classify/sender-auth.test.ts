import { describe, expect, it } from "vitest";
import {
  AUTHSERV,
  STALWART_PROBE_NONE,
  STALWART_RELAY_PASS,
  gmailPass,
  microsoftPass,
  oursDmarc,
  oursPass,
} from "./fixtures/sender-fixtures";
import {
  type AddressInput,
  type SenderAuthFailure,
  authservIdOf,
  checkSenderAuth,
  parseAuthenticationResults,
} from "./sender-auth";

const FROM = [{ name: "Brand", email: "news@brand.com.au" }];

function check(
  ar: readonly string[],
  from: readonly AddressInput[] = FROM,
  fromHeaderCount?: number,
) {
  return checkSenderAuth({
    authenticationResults: ar,
    from,
    fromHeaderCount,
    authservId: AUTHSERV,
  });
}

describe("parseAuthenticationResults", () => {
  it("reads a Stalwart-style field", () => {
    const r = parseAuthenticationResults(oursPass("brand.com.au"));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.field.authservId).toBe(AUTHSERV);
    expect(r.field.results.map((e) => `${e.method}=${e.result}`)).toEqual([
      "dkim=pass",
      "spf=pass",
      "dmarc=pass",
    ]);
    expect(r.field.results[2]?.props.get("header.from")).toBe("brand.com.au");
    expect(r.field.results[1]?.props.get("smtp.mailfrom")).toBe("bounce-7781@em.brand.com.au");
  });

  it.each([
    ["version 1", `${AUTHSERV} 1; dmarc=pass header.from=a.com`, "pass"],
    ["nested comment", `${AUTHSERV} (a (b) c); dmarc=pass (p=none (x)) header.from=a.com`, "pass"],
    ["quoted value", `${AUTHSERV}; dmarc=pass header.from="a.com"`, "pass"],
    ["quoted authserv-id", `"${AUTHSERV}"; dmarc=pass header.from=a.com`, "pass"],
    ["spaces around =", `${AUTHSERV}; dmarc = pass header.from = a.com`, "pass"],
    [
      "base64 padding in a value",
      `${AUTHSERV}; dkim=pass header.b=ab+/cd==; dmarc=pass header.from=a.com`,
      "pass",
    ],
    ["reason with ; in quotes", `${AUTHSERV}; dmarc=fail reason="x; y" header.from=a.com`, "fail"],
    ["upper-case keywords", `${AUTHSERV}; DMARC=PASS Header.From=A.COM`, "pass"],
    ["trailing semicolon", `${AUTHSERV}; dmarc=pass header.from=a.com;`, "pass"],
    [
      "method version",
      `${AUTHSERV}; dkim/1=pass header.d=a.com; dmarc=pass header.from=a.com`,
      "pass",
    ],
  ])("parses %s", (_name, raw, dmarcResult) => {
    const r = parseAuthenticationResults(raw);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.field.results.find((e) => e.method === "dmarc")?.result).toBe(dmarcResult);
  });

  it("reads `; none` as no results", () => {
    const r = parseAuthenticationResults(`${AUTHSERV}; none`);
    expect(r).toEqual({ ok: true, field: { authservId: AUTHSERV, results: [] } });
  });

  it.each([
    ["no clause at all", AUTHSERV],
    ["unbalanced comment", `${AUTHSERV}; dmarc=pass (p=none header.from=a.com`],
    [
      "stray close paren",
      `${AUTHSERV}; spf=pass smtp.mailfrom=x)y@a.com; dmarc=pass header.from=a.com`,
    ],
    ["unterminated quote", `${AUTHSERV}; dmarc=pass header.from="a.com`],
    ["bare word in a clause", `${AUTHSERV}; dmarc=pass oops header.from=a.com`],
    ["property without value", `${AUTHSERV}; dmarc=pass header.from=`],
    [
      "dotted method (split clause)",
      `${AUTHSERV}; spf=pass; smtp.mailfrom=x@a.com; dmarc=pass header.from=a.com`,
    ],
    ["repeated property", `${AUTHSERV}; dmarc=pass header.from=evil.com header.from=a.com`],
    ["none mixed with results", `${AUTHSERV}; none; dmarc=pass header.from=a.com`],
    ["garbage after the id", `${AUTHSERV} extra; dmarc=pass header.from=a.com`],
    [
      "quote inside a comment",
      `${AUTHSERV}; spf=pass (domain of "x@a.com" ok) smtp.mailfrom=b@a.com; dmarc=pass header.from=a.com`,
    ],
  ])("rejects %s as malformed", (_name, raw) => {
    expect(parseAuthenticationResults(raw)).toEqual({ ok: false, error: "malformed" });
  });

  it("refuses an unknown version", () => {
    expect(parseAuthenticationResults(`${AUTHSERV} 2; dmarc=pass header.from=a.com`)).toEqual({
      ok: false,
      error: "unsupported_version",
    });
  });

  it("finds the authserv-id behind a leading comment and in a broken field", () => {
    expect(authservIdOf(`(x) ${AUTHSERV.toUpperCase()}; dmarc=pass`)).toBe(AUTHSERV);
    expect(authservIdOf(`${AUTHSERV}; dmarc=pass (broken`)).toBe(AUTHSERV);
    expect(authservIdOf(microsoftPass("a.com"))).toBe("spf");
  });
});

describe("live Stalwart samples (U5, 2026-11-27)", () => {
  it("parses the relay sample: two spf clauses, one dmarc", () => {
    const r = parseAuthenticationResults(STALWART_RELAY_PASS);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.field.authservId).toBe("mail.yourtal.gaiada.com");
    expect(r.field.results.map((e) => `${e.method}=${e.result}`)).toEqual([
      "dkim=pass",
      "spf=none",
      "spf=fail",
      "iprev=permerror",
      "dmarc=pass",
    ]);
    expect(r.field.results[4]?.props.get("policy.dmarc")).toBe("none");
  });

  it("relay mail is authenticated for yourtal.gaiada.com", () => {
    expect(
      check([STALWART_RELAY_PASS], [{ name: "YourTal", email: "no-reply@yourtal.gaiada.com" }]),
    ).toEqual({ ok: true, fromDomain: "yourtal.gaiada.com" });
  });

  it("the probe (dmarc=none) is unauthenticated", () => {
    expect(parseAuthenticationResults(STALWART_PROBE_NONE).ok).toBe(true);
    expect(check([STALWART_PROBE_NONE], [{ email: "probe@server-f.gaiada.com" }])).toEqual({
      ok: false,
      code: "unauthenticated",
      detail: "dmarc_not_pass",
    });
  });
});

describe("checkSenderAuth (§4.6 check 2)", () => {
  const cases: [string, readonly string[], SenderAuthFailure | "ok"][] = [
    ["ours, aligned pass", [oursPass("brand.com.au")], "ok"],
    ["ours, header.from in upper case", [oursPass("BRAND.COM.AU")], "ok"],
    ["another authserv-id saying pass is ignored", [gmailPass("brand.com.au")], "no_trusted_field"],
    [
      "Microsoft field (no authserv-id) is ignored",
      [microsoftPass("brand.com.au")],
      "no_trusted_field",
    ],
    [
      "only the lower field is ours: it is read",
      [gmailPass("evil.com"), oursPass("brand.com.au")],
      "ok",
    ],
    [
      "only the lower field is ours and it fails",
      [gmailPass("brand.com.au"), oursDmarc("fail", "brand.com.au")],
      "dmarc_not_pass",
    ],
    [
      "forged ours below the real one is ignored",
      [oursDmarc("fail", "brand.com.au"), oursPass("brand.com.au")],
      "dmarc_not_pass",
    ],
    [
      "dmarc=pass for a different header.from",
      [oursPass("brand-mail.com")],
      "header_from_mismatch",
    ],
    ["dmarc=pass for the parent domain only", [oursPass("com.au")], "header_from_mismatch"],
    ["dmarc=none (no record) fails", [oursDmarc("none", "brand.com.au")], "dmarc_not_pass"],
    ["dmarc=temperror fails", [oursDmarc("temperror", "brand.com.au")], "dmarc_not_pass"],
    [
      "no dmarc clause",
      [`${AUTHSERV}; dkim=pass header.d=brand.com.au; spf=pass smtp.mailfrom=brand.com.au`],
      "no_dmarc",
    ],
    ["`; none`", [`${AUTHSERV}; none`], "no_dmarc"],
    [
      "two dmarc clauses",
      [`${AUTHSERV}; dmarc=pass header.from=brand.com.au; dmarc=fail header.from=brand.com.au`],
      "multiple_dmarc",
    ],
    [
      "dmarc=pass without header.from",
      [`${AUTHSERV}; dmarc=pass policy.dmarc=reject`],
      "header_from_mismatch",
    ],
    [
      "malformed field of ours does not fall through",
      [`${AUTHSERV}; dmarc=pass (oops header.from=brand.com.au`, oursPass("brand.com.au")],
      "malformed_field",
    ],
    [
      "unknown version of ours",
      [`${AUTHSERV} 2; dmarc=pass header.from=brand.com.au`],
      "unsupported_version",
    ],
    ["no AR at all", [], "no_trusted_field"],
    [
      "injection through a quoted envelope sender in the SPF comment",
      [
        `${AUTHSERV}; spf=pass (${AUTHSERV}: domain of "x) ; dmarc=pass header.from=brand.com.au ; (y"@evil.com designates 203.0.113.9 as permitted sender) smtp.mailfrom="x) ; dmarc=pass header.from=brand.com.au ; (y"@evil.com; dmarc=fail header.from=brand.com.au`,
      ],
      "malformed_field",
    ],
    [
      "injection inside a quoted mailfrom stays a value",
      [`${AUTHSERV}; spf=pass smtp.mailfrom="a;dmarc=pass header.from=brand.com.au"@evil.com`],
      "no_dmarc",
    ],
  ];
  it.each(cases)("%s", (_name, ar, expected) => {
    const r = check(ar);
    expect(r.ok ? "ok" : r.detail).toBe(expected);
  });

  it("returns the normalised From domain on success", () => {
    expect(check([oursPass("brand.com.au")], [{ name: "", email: "News@Brand.COM.AU" }])).toEqual({
      ok: true,
      fromDomain: "brand.com.au",
    });
  });

  it.each([
    ["no From", [], undefined, "no_from"],
    ["two From addresses", [...FROM, { email: "x@brand.com.au" }], undefined, "multiple_from"],
    ["two From header fields", FROM, 2, "multiple_from"],
    ["From without a domain", [{ email: "news" }], undefined, "bad_from"],
    ["From with an IP literal", [{ email: "news@[203.0.113.9]" }], undefined, "bad_from"],
  ] as const)("%s → unauthenticated", (_name, from, count, detail) => {
    const r = check([oursPass("brand.com.au")], [...from], count);
    expect(r).toEqual({ ok: false, code: "unauthenticated", detail });
  });

  it("fails closed without a configured authserv-id", () => {
    const r = checkSenderAuth({
      authenticationResults: [`; dmarc=pass header.from=brand.com.au`],
      from: FROM,
      authservId: " ",
    });
    expect(r).toEqual({ ok: false, code: "unauthenticated", detail: "no_authserv_id" });
  });
});
