import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Signed per-session segment URLs. YT-0220's second criterion.
 *
 * ## The half this completes, and why the other half was not a control
 *
 * `delivery-log.test.ts` already proves per-segment fetches are retrievable:
 * one request logged per segment, with bytes delivered. That is a
 * **statistic** until the URL identifies a session. `docs/22`'s option A —
 * the reason self-hosting was chosen at all — is cross-checking a *claimed*
 * playback position against delivery logs, and a log that records
 * *something fetched segment 4* without recording *whose* session cannot
 * support that cross-check. YT-0220 lists the log and the signing as two
 * bullets; they are one control, and this is its load-bearing half.
 *
 * ## The session id is inside the signature, never beside it
 *
 * The whole claims blob is signed, so `sessionId` cannot be edited without
 * invalidating the signature. The tempting alternative — signing the object
 * key and passing `?session=` alongside — validates perfectly while the
 * caller picks whatever session they like, and the delivery log then
 * faithfully records an attacker-chosen identity. **That is worse than no
 * attribution at all**, because the log looks authoritative.
 *
 * Same reason `verifySegmentUrl` returns the claims rather than a bare
 * boolean, exactly as `watch-checkpoint-token.ts` does: the log must record
 * the session that was **verified**, not one read out of the request
 * separately. A boolean would let a caller check the signature and then log
 * a query parameter, which is the bug with an extra step.
 *
 * ## Bound to one segment, not to the asset
 *
 * The rendition and segment file are in the claims, so a token minted for
 * `v0/segment0.ts` does not fetch `v2/segment7.ts`. Without that, one signed
 * URL unlocks the whole ladder and per-segment granularity in the log
 * becomes decorative — you would see which URL was issued, never which
 * bytes were taken.
 *
 * ## Expiry is sized against the segment, not the session
 *
 * A URL that lives as long as the watch session is a shareable download
 * link for the asset, valid for the whole sitting. Segment-scoped expiry
 * keeps the sharing window to roughly the time the player legitimately
 * needs the segment, so a leaked URL ages out during the view rather than
 * after it.
 *
 * ## What this cannot do, stated because the plan once assumed otherwise
 *
 * It does not prove a human watched. `hls-origin.ts` is explicit that
 * delivery is an upper bound — *"you cannot claim more than was fetched"* —
 * and that a `curl` loop can pull every segment in seconds. Signing makes
 * the ceiling **attributable**; it does not make it evidence of attention.
 * A session that genuinely fetched every segment in eight seconds is now
 * visible as such, which is the actual win.
 */

/** Distinct from every other HMAC domain in the repo, so a token cannot cross modules. */
const SEGMENT_URL_DOMAIN = "yt:media:segment:v1";

/**
 * How long a signed segment URL stays valid.
 *
 * Two minutes: comfortably more than a player needs to fetch a segment it
 * is about to play, including a stall and a retry, and far less than a
 * viewing session. Raising this toward the session length turns each URL
 * back into a shareable asset link, which is the thing segment-scoped
 * expiry exists to prevent.
 */
export const SEGMENT_URL_TTL_MS = 120_000;

export interface SegmentClaims {
  /** The watch session this URL was minted for. Inside the signature. */
  readonly sessionId: string;
  readonly assetId: string;
  /** Rendition directory, e.g. `v0`. Part of the binding. */
  readonly renditionDir: string;
  /** Segment filename, e.g. `segment3.ts`. Part of the binding. */
  readonly segmentFile: string;
  /** Absolute expiry, ms epoch. Inside the signature, never beside it. */
  readonly expiresAtMs: number;
}

export type SegmentUrlFailure =
  | { readonly kind: "malformed" }
  | { readonly kind: "bad_signature" }
  | { readonly kind: "expired"; readonly ageMs: number }
  | { readonly kind: "wrong_object"; readonly signedFor: string };

/**
 * The outcome of presenting a signed URL.
 *
 * A refusal is a value, not an exception, for the same reason
 * `CheckpointVerdict` is: an expired segment URL is ordinary traffic — a
 * paused tab resuming, a slow network, a retry after a stall — and an
 * origin that throws on ordinary traffic grows a catch block that swallows
 * real errors with it.
 */
export type SegmentUrlVerdict =
  | { readonly accepted: true; readonly claims: SegmentClaims }
  | { readonly accepted: false; readonly reason: SegmentUrlFailure };

function sign(material: string, secret: string): string {
  return createHmac("sha256", secret).update(`${SEGMENT_URL_DOMAIN}.${material}`).digest("hex");
}

function constantTimeEquals(left: string, right: string): boolean {
  const leftBytes = Buffer.from(left, "utf8");
  const rightBytes = Buffer.from(right, "utf8");
  // Length first: `timingSafeEqual` throws on a length mismatch and the
  // throw itself leaks the length. Same shape and same reasoning as
  // `watch-checkpoint-token.ts` and `drivers/boundaries/webhook-signature.ts`.
  if (leftBytes.length !== rightBytes.length) return false;
  return timingSafeEqual(leftBytes, rightBytes);
}

/** The opaque token: `<base64url(claims)>.<hmac>`. */
export function issueSegmentToken(claims: SegmentClaims, secret: string): string {
  const encoded = Buffer.from(JSON.stringify(claims), "utf8").toString("base64url");
  return `${encoded}.${sign(encoded, secret)}`;
}

export interface MintSegmentUrlInput {
  readonly baseUrl: string;
  readonly sessionId: string;
  readonly assetId: string;
  readonly renditionDir: string;
  readonly segmentFile: string;
  readonly nowMs: number;
  readonly secret: string;
  /** Override the default TTL. Rarely right; see `SEGMENT_URL_TTL_MS`. */
  readonly ttlMs?: number;
}

/**
 * A complete signed URL for one segment of one session.
 *
 * The token rides in a single `t` parameter. Nothing else about the session
 * appears in the query string — an adjacent `session=` would be the exact
 * unsigned-identity mistake this module exists to prevent, and having the
 * field available to read is how that mistake gets made.
 */
export function mintSegmentUrl(input: MintSegmentUrlInput): string {
  const claims: SegmentClaims = {
    sessionId: input.sessionId,
    assetId: input.assetId,
    renditionDir: input.renditionDir,
    segmentFile: input.segmentFile,
    expiresAtMs: input.nowMs + (input.ttlMs ?? SEGMENT_URL_TTL_MS),
  };
  const token = issueSegmentToken(claims, input.secret);
  const base = input.baseUrl.replace(/\/+$/, "");
  return `${base}/${input.assetId}/${input.renditionDir}/${input.segmentFile}?t=${token}`;
}

export interface VerifySegmentUrlInput {
  readonly token: string;
  /** The object actually being requested, from the origin's own routing. */
  readonly requestedAssetId: string;
  readonly requestedRenditionDir: string;
  readonly requestedSegmentFile: string;
  readonly nowMs: number;
  readonly secret: string;
}

/**
 * Verifies a presented token against the object actually requested.
 *
 * The requested object comes from the origin's routing, **not** from the
 * token. Comparing the token against itself would accept any well-signed
 * token for any object — the check has to be against what the request is
 * really reaching for.
 *
 * Order matters: signature before expiry. An expired token whose signature
 * is forged should report `bad_signature`, because reporting `expired`
 * would confirm to a forger that everything except the clock was right.
 */
export function verifySegmentUrl(input: VerifySegmentUrlInput): SegmentUrlVerdict {
  const parts = input.token.split(".");
  if (parts.length !== 2) return { accepted: false, reason: { kind: "malformed" } };

  const [encoded, presented] = parts;
  if (encoded === undefined || presented === undefined || encoded === "" || presented === "") {
    return { accepted: false, reason: { kind: "malformed" } };
  }

  if (!constantTimeEquals(presented, sign(encoded, input.secret))) {
    return { accepted: false, reason: { kind: "bad_signature" } };
  }

  let claims: SegmentClaims;
  try {
    claims = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")) as SegmentClaims;
  } catch {
    return { accepted: false, reason: { kind: "malformed" } };
  }

  if (
    typeof claims.sessionId !== "string" ||
    typeof claims.assetId !== "string" ||
    typeof claims.renditionDir !== "string" ||
    typeof claims.segmentFile !== "string" ||
    typeof claims.expiresAtMs !== "number"
  ) {
    return { accepted: false, reason: { kind: "malformed" } };
  }

  const signedObject = `${claims.assetId}/${claims.renditionDir}/${claims.segmentFile}`;
  const requestedObject = `${input.requestedAssetId}/${input.requestedRenditionDir}/${input.requestedSegmentFile}`;
  if (signedObject !== requestedObject) {
    return { accepted: false, reason: { kind: "wrong_object", signedFor: signedObject } };
  }

  if (input.nowMs > claims.expiresAtMs) {
    return {
      accepted: false,
      reason: { kind: "expired", ageMs: input.nowMs - claims.expiresAtMs },
    };
  }

  return { accepted: true, claims };
}

/**
 * What a delivery-log writer should record for an accepted request.
 *
 * Exists so the log cannot be written from a request parameter. It takes
 * the **verdict**, not a session id, so there is no way to call it without
 * having verified — the session it records is the one the signature
 * carried. Passing a `sessionId: string` here would make the unattributable
 * log reachable again through an easier door.
 */
export function attributableSession(verdict: SegmentUrlVerdict): string | undefined {
  return verdict.accepted ? verdict.claims.sessionId : undefined;
}
