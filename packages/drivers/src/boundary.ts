/**
 * Every place this platform talks to someone else. YT-0535.
 *
 * ## Why a registry rather than eight independent modules
 *
 * The decision of 2026-09-19 is that **all third-party connections are held**
 * and every external boundary runs a simulator. That buys deployment speed
 * and costs evidence, which `docs/03` risk 41 names precisely: *"a simulator
 * is our guess about a vendor, wearing a green test."* It is risk 37 —
 * guarantees that stay green by never running — in a new costume.
 *
 * The defence is that the boundaries are **enumerable**. If every external
 * call goes through one of the entries below, then "what are we currently
 * guessing about?" is a question with an exact answer, and a parity suite
 * (YT-0539) has a finite list to run against both drivers. A boundary that
 * is not in this table is one nobody is tracking, so adding a vendor call
 * without adding a row here is what the lint rule exists to stop.
 *
 * ## What each row has to carry
 *
 * `liveCredentialEnvVars` is the load-bearing field. Selecting `live`
 * without those variables **fails at boot** rather than falling back to the
 * simulator, because a silent fallback in production is indistinguishable
 * from working — you would ship a payment flow that settles nothing and
 * reports success. Naming the exact variables means the failure says what to
 * set, not merely that something is missing.
 */

export const BOUNDARY_NAMES = [
  "payments",
  "disbursement",
  "bot_check",
  "otp",
  "messaging",
  "digital_goods",
  "receipt_ingest",
  "moderation",
  "device_reputation",
] as const;

export type BoundaryName = (typeof BOUNDARY_NAMES)[number];

export interface BoundaryDefinition {
  readonly name: BoundaryName;
  /** What breaks if this boundary is wrong. Written for whoever reads a boot failure. */
  readonly purpose: string;
  /** The variable that chooses a driver, e.g. `PAYMENTS_DRIVER`. */
  readonly modeEnvVar: string;
  /** Every variable `live` needs. Missing any of them is a boot failure. */
  readonly liveCredentialEnvVars: readonly string[];
  /** Who we expect to integrate with, and what is unresolved about them. */
  readonly liveVendor: string;
  /** The ticket that will implement the live driver. */
  readonly liveTicket: string;
}

export const BOUNDARIES: Record<BoundaryName, BoundaryDefinition> = {
  payments: {
    name: "payments",
    purpose: "Taking money from a user to buy points (docs/09 §4).",
    modeEnvVar: "PAYMENTS_DRIVER",
    liveCredentialEnvVars: ["PAYMENTS_API_KEY", "PAYMENTS_WEBHOOK_SECRET"],
    liveVendor:
      "Xendit in Indonesia, Stripe in Australia. The two may disagree about the IDR amount unit: " +
      "YT-0506 settled what we STORE (sen), not what a processor accepts, and Adyen publicly flags " +
      "IDR as diverging from ISO. The unit is therefore a declared property of the driver (YT-0537).",
    liveTicket: "YT-0537",
  },
  disbursement: {
    name: "disbursement",
    purpose: "Paying a merchant what their redeemed vouchers settled at.",
    modeEnvVar: "DISBURSEMENT_DRIVER",
    liveCredentialEnvVars: ["DISBURSEMENT_API_KEY", "DISBURSEMENT_WEBHOOK_SECRET"],
    liveVendor: "Xendit Disbursements.",
    liveTicket: "YT-0537",
  },
  bot_check: {
    name: "bot_check",
    purpose: "Proving a signup or a claim came from a browser, not a script (docs/08).",
    modeEnvVar: "BOT_CHECK_DRIVER",
    liveCredentialEnvVars: ["TURNSTILE_SITE_KEY", "TURNSTILE_SECRET_KEY"],
    liveVendor:
      "Cloudflare Turnstile. The only boundary that can genuinely run live today: Cloudflare " +
      "publishes always-pass and always-fail test keys, which `.env.example` already carries.",
    liveTicket: "YT-0538",
  },
  otp: {
    name: "otp",
    purpose:
      "Phone verification. docs/18 §5's fraud model rests on this as its identity anchor, and " +
      "deferring it is what YT-0542 records the cost of — email and password alone make a fake " +
      "account nearly free.",
    modeEnvVar: "OTP_DRIVER",
    liveCredentialEnvVars: ["OTP_API_KEY", "OTP_SENDER_ID"],
    liveVendor: "An Indonesian SMS gateway, not yet chosen.",
    liveTicket: "YT-0538",
  },
  messaging: {
    name: "messaging",
    purpose: "Telling a user something happened, outside the app.",
    modeEnvVar: "MESSAGING_DRIVER",
    liveCredentialEnvVars: ["MESSAGING_API_KEY", "MESSAGING_SENDER_ID"],
    liveVendor: "WhatsApp Business API.",
    liveTicket: "YT-0538",
  },
  digital_goods: {
    name: "digital_goods",
    purpose: "Sourcing a redeemable code from a supplier at the moment of redemption.",
    modeEnvVar: "DIGITAL_GOODS_DRIVER",
    liveCredentialEnvVars: ["DIGITAL_GOODS_API_KEY"],
    liveVendor: "A voucher aggregator, not yet chosen.",
    liveTicket: "YT-0535",
  },
  receipt_ingest: {
    name: "receipt_ingest",
    purpose: "Reading a photographed receipt so a spend can be attributed.",
    modeEnvVar: "RECEIPT_INGEST_DRIVER",
    liveCredentialEnvVars: ["RECEIPT_INGEST_API_KEY"],
    liveVendor: "An OCR service, not yet chosen.",
    liveTicket: "YT-0535",
  },
  device_reputation: {
    name: "device_reputation",
    purpose:
      "Reputation of the network a registration arrived from (YT-0051). The one " +
      "device signal that cannot be computed locally -- fingerprinting and headless " +
      "detection run in the client; this needs somebody's view of which networks " +
      "have been abusive lately.",
    modeEnvVar: "DEVICE_REPUTATION_DRIVER",
    liveCredentialEnvVars: ["DEVICE_REPUTATION_API_KEY"],
    liveVendor: "An IP intelligence provider, not yet chosen.",
    liveTicket: "YT-0051",
  },
  moderation: {
    name: "moderation",
    purpose: "Judging whether user-submitted text is publishable.",
    modeEnvVar: "MODERATION_DRIVER",
    liveCredentialEnvVars: ["MODERATION_API_KEY"],
    liveVendor: "An LLM provider, not yet chosen.",
    liveTicket: "YT-0535",
  },
};

export function boundaryDefinition(name: BoundaryName): BoundaryDefinition {
  return BOUNDARIES[name];
}
