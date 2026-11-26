import { automaticReason } from "./automatic";
import { hasBulkMarkers, hasListUnsubscribe, isBulkForFiling } from "./bulk";
import { isFreemail, isOwnDomain } from "./domains";
import type { HeaderInput } from "./header-values";
import { neverReplyReason } from "./never-reply";
import { isDotAtomLocalPart, orgDomainOf, splitAddress } from "./org-domain";
import { type AddressInput, checkSenderAuth } from "./sender-auth";

/** One message's sender facts; build it with `senderInputFromJmap`. */
export interface SenderInput {
  readonly from: readonly AddressInput[] | null;
  readonly fromHeaderCount?: number | undefined;
  readonly replyTo: readonly AddressInput[] | null;
  /** Topmost first. */
  readonly authenticationResults: readonly string[];
  readonly listUnsubscribe: HeaderInput;
  readonly listId: HeaderInput;
  readonly precedence: HeaderInput;
  readonly autoSubmitted: HeaderInput;
  readonly xAutoreply: HeaderInput;
  readonly xAutorespond: HeaderInput;
  readonly xAutoResponseSuppress: HeaderInput;
  readonly returnPath: HeaderInput;
  readonly contentType: string | null;
}

export interface ClassifyConfig {
  /** `SPAMBANK_AUTHSERV_ID`. */
  readonly authservId: string;
  /** `parseOwnDomains(SPAMBANK_OWN_DOMAINS)`. */
  readonly ownOrgDomains: readonly string[];
}

/** §4.6 skip codes of checks 2–7, plus `invalid_address` (no usable domain or envelope address). */
export type SenderSkipCode =
  | "unauthenticated"
  | "not_bulk"
  | "auto_or_bounce"
  | "noreply_address"
  | "own_domain"
  | "freemail"
  | "invalid_address";

/** The finer reason behind a code (`SenderAuthFailure`, `AutomaticReason`, `NeverReplyReason`, a domain). */
export type SkipDetail = string;

export type AutoreplyVerdict =
  | { readonly eligible: true; readonly target: string; readonly orgDomain: string }
  | { readonly eligible: false; readonly code: SenderSkipCode; readonly detail: SkipDetail };

type LeadSkipCode = Exclude<SenderSkipCode, "noreply_address">;

export type LeadVerdict =
  | { readonly eligible: true; readonly orgDomain: string }
  | { readonly eligible: false; readonly code: LeadSkipCode; readonly detail: SkipDetail };

export interface SenderClassification {
  /** The trusted `dmarc=pass` (check 2); also gates statements (§4.8). */
  readonly dmarcPass: boolean;
  /** Lower-case domain, case-kept local part; null when From is not one usable address. */
  readonly fromAddress: string | null;
  readonly fromOrgDomain: string | null;
  /** §4.2 Junk rule (`ingested_message.bulk`). */
  readonly bulk: boolean;
  readonly hasListUnsubscribe: boolean;
  /** Checks 2–7 in order; T7 runs 0–1 before and 8–10 after. */
  readonly autoreply: AutoreplyVerdict;
  /** §4.7: checks 2, 3, 4 and 6 (no-reply senders still count as brands). */
  readonly lead: LeadVerdict;
}

type Skip = { readonly code: LeadSkipCode; readonly detail: SkipDetail };

/** Check 6. */
function domainCheck(orgDomain: string | null, config: ClassifyConfig): Skip | null {
  if (orgDomain === null) return { code: "invalid_address", detail: "no_org_domain" };
  if (isOwnDomain(orgDomain, config.ownOrgDomains))
    return { code: "own_domain", detail: orgDomain };
  if (isFreemail(orgDomain)) return { code: "freemail", detail: orgDomain };
  return null;
}

/** Check 7: From, or a single `Reply-To` on From's registrable domain; then 5 and 6 again. */
function replyTarget(
  input: SenderInput,
  fromLocal: string,
  fromDomain: string,
  fromOrg: string,
  config: ClassifyConfig,
): AutoreplyVerdict {
  let local = fromLocal;
  let domain = fromDomain;
  const replyTo = input.replyTo ?? [];
  if (replyTo.length === 1) {
    const rt = splitAddress(replyTo[0]?.email ?? "");
    if (rt !== null && orgDomainOf(rt.domain) === fromOrg) {
      local = rt.local;
      domain = rt.domain;
    }
  }
  const never = neverReplyReason(local);
  if (never !== null) return { eligible: false, code: "noreply_address", detail: never };
  const skip = domainCheck(orgDomainOf(domain), config);
  if (skip !== null) return { eligible: false, ...skip };
  if (!isDotAtomLocalPart(local)) {
    return { eligible: false, code: "invalid_address", detail: "not_dot_atom" };
  }
  return { eligible: true, target: `${local}@${domain}`, orgDomain: fromOrg };
}

export function classifySender(input: SenderInput, config: ClassifyConfig): SenderClassification {
  const auth = checkSenderAuth({
    authenticationResults: input.authenticationResults,
    from: input.from,
    fromHeaderCount: input.fromHeaderCount,
    authservId: config.authservId,
  });
  const from = (input.from ?? []).length === 1 ? splitAddress(input.from?.[0]?.email ?? "") : null;
  const fromOrg = from === null ? null : orgDomainOf(from.domain);
  const bulkMarkers = hasBulkMarkers(input);
  const automatic = automaticReason(input);

  // Checks 2, 3, 4, then 6: shared by the lead and the auto-reply.
  let common: Skip | null = null;
  if (!auth.ok) common = { code: auth.code, detail: auth.detail };
  else if (!bulkMarkers) common = { code: "not_bulk", detail: "no_markers" };
  else if (automatic !== null) common = { code: "auto_or_bounce", detail: automatic };

  const leadSkip = common ?? domainCheck(fromOrg, config);
  const lead: LeadVerdict =
    leadSkip !== null
      ? { eligible: false, ...leadSkip }
      : fromOrg !== null
        ? { eligible: true, orgDomain: fromOrg }
        : { eligible: false, code: "invalid_address", detail: "no_org_domain" };

  let autoreply: AutoreplyVerdict;
  if (common !== null) autoreply = { eligible: false, ...common };
  else if (from === null || fromOrg === null) {
    autoreply = { eligible: false, code: "invalid_address", detail: "no_org_domain" };
  } else {
    const never = neverReplyReason(from.local);
    const skip = never === null ? domainCheck(fromOrg, config) : null;
    if (never !== null) autoreply = { eligible: false, code: "noreply_address", detail: never };
    else if (skip !== null) autoreply = { eligible: false, ...skip };
    else autoreply = replyTarget(input, from.local, from.domain, fromOrg, config);
  }

  return {
    dmarcPass: auth.ok,
    fromAddress: from === null ? null : `${from.local}@${from.domain}`,
    fromOrgDomain: fromOrg,
    bulk: isBulkForFiling(input),
    hasListUnsubscribe: hasListUnsubscribe(input),
    autoreply,
    lead,
  };
}
