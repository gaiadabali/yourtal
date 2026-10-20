import { randomBytes, randomInt } from "node:crypto";

const BASE62 = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";

/** Uniform base62 string of `length` chars from the OS CSPRNG. */
export function randomBase62(length: number): string {
  let out = "";
  for (let i = 0; i < length; i += 1) out += BASE62.charAt(randomInt(BASE62.length));
  return out;
}

/** A Stripe-style id: prefix + 24 random base62 chars. */
export function newId(prefix: string): string {
  return `${prefix}${randomBase62(24)}`;
}

/** Long single-use secrets (onboarding links). */
export function newToken(prefix: string): string {
  return `${prefix}${randomBase62(40)}`;
}

export function newRequestId(): string {
  return `req_${randomBytes(9).toString("hex")}`;
}

export const ID_PREFIX = {
  customer: "cus_",
  session: "cs_test_",
  paymentIntent: "pi_",
  charge: "ch_",
  setupIntent: "seti_",
  paymentMethod: "pm_",
  refund: "re_",
  account: "acct_",
  transfer: "tr_",
  payout: "po_",
  bankAccount: "ba_",
  event: "evt_",
  accountLink: "acl_",
} as const;
