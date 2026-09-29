import { createHash } from "node:crypto";
import type { FastifyRequest } from "fastify";

/**
 * 11.2.b: the F12 per-IP Open Viewing cap is enforced against a HASH of the
 * caller's IP, never the raw address — this table's only purpose is a rate
 * limit, not identifying a visitor, so there is nothing here worth storing
 * in the clear (Helios red line 11: demo data only, no incidental PII).
 *
 * `request.ip` is Fastify's own resolved client address, honouring
 * `trustProxy: true` (`main.ts`, 1.5.e) — behind Helios's real nginx this is
 * the actual client, not the proxy hop; in dev it is `127.0.0.1` for every
 * caller, which is fine (the cap still exercises correctly, just shared
 * across one dev machine's own requests).
 */
export function hashRequestIp(request: FastifyRequest): string {
  return createHash("sha256").update(request.ip).digest("hex");
}
