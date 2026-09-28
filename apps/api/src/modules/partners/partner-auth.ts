import { createHmac, timingSafeEqual } from "node:crypto";
import type { FastifyRequest } from "fastify";
import type { PartnerCredentialRepository } from "./persistence/partner-credential.repository";

/**
 * TASKS.md 8.4.a: "authenticated with the partner HMAC credential only" —
 * no session, no Cerbos principal (an external system calling in; there is
 * exactly one partner today, snap-app, docs/16). `Authorization: Partner
 * <partnerId>:<hex-hmac-sha256 of the raw request body>`, verified against
 * the RAW bytes (`request.rawBody`, `main.ts`'s `rawBody: true`) — a
 * re-serialized parsed body is not guaranteed byte-identical to what the
 * caller actually signed.
 */
export interface VerifiedPartner {
  readonly partnerId: string;
}

const HEADER_PATTERN = /^Partner ([^:]+):([0-9a-f]{64})$/u;

export async function verifyPartnerSignature(
  request: FastifyRequest,
  credentials: PartnerCredentialRepository,
): Promise<VerifiedPartner | null> {
  const header = request.headers.authorization;
  if (typeof header !== "string") return null;
  const match = HEADER_PATTERN.exec(header);
  if (match === null) return null;
  const [, partnerId, signature] = match;
  if (partnerId === undefined || signature === undefined) return null;

  const credential = await credentials.findById(partnerId);
  if (credential === null) return null;

  const expected = createHmac("sha256", credential.secret)
    .update(rawBodyOf(request), "utf8")
    .digest("hex");

  // Constant-time: both sides are hex strings of the same fixed length
  // (a sha256 digest), so this never leaks a length difference either.
  const a = Buffer.from(signature, "hex");
  const b = Buffer.from(expected, "hex");
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;

  return { partnerId };
}

/**
 * TASKS.md 8.4.c: the request-property name `PartnerAuthGuard` (this
 * module) writes the verified partner id under, and
 * `IdempotencyInterceptor`'s `scopeBy: "partner"` reads it back from — a
 * plain string-key convention, not an import, which is the point: it is
 * how `shared/idempotency` gets a per-partner scope without ever depending
 * on `modules/partners` (the wrong dependency direction for a shared
 * module). Same `Reflect`-on-request idiom `rawBodyOf` below already uses
 * for Fastify's own dynamically-attached `rawBody`.
 */
export const VERIFIED_PARTNER_REQUEST_KEY = "verifiedPartnerId";

/** Reads back what `PartnerAuthGuard` already verified — never re-verifies. */
export function verifiedPartnerIdOf(request: FastifyRequest): string | undefined {
  const value: unknown = Reflect.get(request, VERIFIED_PARTNER_REQUEST_KEY);
  return typeof value === "string" ? value : undefined;
}

/**
 * Same `Reflect.get` shape `shared/idempotency/idempotency.interceptor.ts`'s
 * own `rawBodyOf` uses — Fastify's `rawBody: true` (main.ts) attaches it
 * dynamically, so the type does not appear on `FastifyRequest` itself.
 */
function rawBodyOf(request: FastifyRequest): string {
  const raw: unknown = Reflect.get(request, "rawBody");
  if (typeof raw === "string") return raw;
  if (raw instanceof Buffer) return raw.toString("utf8");
  return "";
}
