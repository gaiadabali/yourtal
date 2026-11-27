import { z } from "zod";
import { AUTOREPLY_MODES } from "@yourtal/contracts/spambank/common";
import type { AutoreplyMode } from "@yourtal/contracts/spambank/common";
import { abnDigits, isValidAbn } from "../modules/spambank/autoreply/abn";

/**
 * Spambank's settings (spambank/BUILD.md §5.8), kept out of `env.schema.ts` and `app-config.ts` so
 * they stay readable. All optional with safe defaults: a deployment with none of them is the
 * simulated driver and `autoreply: off`.
 *
 * `SPAMBANK_DRIVER` itself is not here: `@yourtal/drivers` reads it (and refuses `live` without the
 * variables `boundary.ts` lists).
 */

const SECRET_MIN = 32;

const flag = z
  .enum(["0", "1", "true", "false"])
  .optional()
  .transform((value) => value !== "0" && value !== "false");

const list = (fallback: string) =>
  z
    .string()
    .default(fallback)
    .transform((value) =>
      value
        .split(",")
        .map((item) => item.trim())
        .filter((item) => item !== ""),
    );

const hostName = z
  .string()
  .regex(
    /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/,
    "must be a lower-case host name",
  );

export const spambankEnvShape = {
  /** Where Stalwart listens, on loopback. An address only. */
  SPAMBANK_STALWART_URL: z.url().optional(),
  /** The service's Stalwart API key. */
  SPAMBANK_STALWART_API_KEY: z.string().min(8).optional(),
  /** Derives every mailbox's Stalwart password. Never stored, never logged. */
  SPAMBANK_CREDENTIAL_KEY: z.string().min(SECRET_MIN).optional(),
  /** Signs the 30-minute mail token. */
  SPAMBANK_TOKEN_KEY: z.string().min(SECRET_MIN).optional(),
  /** Verifies Stalwart's `X-Signature` on its webhook. */
  SPAMBANK_WEBHOOK_SECRET: z.string().min(SECRET_MIN).optional(),
  /** Signs the opt-out links in auto-replies. */
  SPAMBANK_OPTOUT_KEY: z.string().min(SECRET_MIN).optional(),
  /** The mailbox domain, and the one auto-replies are sent from. */
  SPAMBANK_MAIL_DOMAIN: hostName.default("yourtal.gaiada.com"),
  SPAMBANK_REPLY_DOMAIN: hostName.default("spambank.yourtal.gaiada.com"),
  /** The public name phone mail apps connect to (IMAP 993, SMTP 465). */
  SPAMBANK_PUBLIC_HOST: hostName.default("mail.yourtal.gaiada.com"),
  /**
   * The authserv-id on the `Authentication-Results` field Stalwart adds (U5). Only a field with this id
   * is trusted; unset means the public host, and a wrong value fails safe: nothing authenticates, so
   * nothing is auto-replied to.
   */
  SPAMBANK_AUTHSERV_ID: z.string().min(1).max(255).optional(),
  /** Browser origins the mail API answers CORS for. Empty: none. */
  SPAMBANK_CORS_ORIGINS: list(""),
  /** One-line off switch for YourTal's own screens: unset is on. */
  SPAMBANK_ENABLED: flag,
  SPAMBANK_QUOTA_BYTES: z.coerce
    .number()
    .int()
    .min(1_048_576)
    .max(1_099_511_627_776)
    .default(2_147_483_648),
  /** Unset is `off`, the hard switch; staging sets `dry_run` first. */
  SPAMBANK_AUTOREPLY_MODE: z.enum(AUTOREPLY_MODES).default("off"),
  /** `redirect` mode sends every auto-reply here instead of to the sender. */
  SPAMBANK_AUTOREPLY_REDIRECT_TO: z.email().optional(),
  /** The first value of the daily cap; staff change it afterwards in `spambank.control`. */
  SPAMBANK_AUTOREPLY_DAILY_CAP: z.coerce.number().int().min(0).max(10_000).default(200),
  /** Registrable domains that are ours: never auto-replied to. */
  SPAMBANK_OWN_DOMAINS: list("gaiada.com,freetaxreturns.com.au,yourtal.com"),
  /** Who is emailed when auto-reply pauses itself. */
  SPAMBANK_ALERT_EMAILS: list(""),
  SPAMBANK_BANNER_URL: z.url().default("https://yourtal.gaiada.com/studio/onboarding"),
  /**
   * GOD's ABN for the auto-reply's Spam Act footer (11 digits, spaces allowed). Unset shows the owner's
   * mock line; production refuses `SPAMBANK_AUTOREPLY_MODE=live` until it is set (BUILD.md §12.3).
   */
  SPAMBANK_SENDER_ABN: z.string().max(20).optional(),
  /** The auto-reply's contact address and call to action. Production `live` needs it set explicitly. */
  SPAMBANK_CONTACT_EMAIL: z.email().max(254).optional(),
  /** Sending IPs the daily blocklist check looks up (Helios's, BUILD.md §4.6). */
  SPAMBANK_BLOCKLIST_IPS: list("187.77.116.133"),
  /** Domains the daily blocklist check looks up in the Spamhaus DBL. */
  SPAMBANK_BLOCKLIST_DOMAINS: list("spambank.yourtal.gaiada.com,yourtal.gaiada.com,gaiada.com"),
};

/** The owner's contact address for the reply (BUILD.md §12.3), used while the setting is unset. */
export const DEFAULT_CONTACT_EMAIL = "hello@god.gaiada.com";

type SpambankEnv = z.output<z.ZodObject<typeof spambankEnvShape>>;

export interface SpambankConfig {
  /** YourTal's own switch (§4.12); the machine routes, proxy and jobs keep serving the other apps. */
  readonly enabled: boolean;
  readonly stalwartUrl?: string;
  readonly apiKey?: string;
  readonly credentialKey?: string;
  readonly tokenKey?: string;
  readonly webhookSecret?: string;
  readonly optoutKey?: string;
  readonly mailDomain: string;
  readonly replyDomain: string;
  readonly publicHost: string;
  readonly authservId: string;
  readonly corsOrigins: readonly string[];
  readonly quotaBytes: number;
  readonly autoreply: {
    readonly mode: AutoreplyMode;
    readonly redirectTo?: string;
    readonly dailyCap: number;
  };
  readonly ownDomains: readonly string[];
  readonly alertEmails: readonly string[];
  readonly bannerUrl: string;
  /** What the auto-reply says about its sender (Spam Act footer) and where its opt-out links point. */
  readonly sender: {
    /** 11 digits, or null: the reply then shows the mock line (refused for `live` in production). */
    readonly abn: string | null;
    readonly contactEmail: string;
    /** Origin of the opt-out links (`/api/spambank/optout/...` and the `/spambank/optout/...` page). */
    readonly publicOrigin: string;
  };
  readonly blocklist: {
    readonly ips: readonly string[];
    readonly domains: readonly string[];
  };
}

/** Where the config is loaded: the API passes its own web origin; the worker derives the same one. */
export interface SpambankConfigContext {
  readonly appEnv?: "dev" | "staging" | "production";
  /** `AppConfig.webOrigin` (yourtal.gaiada.com serves both the web app and `/api`). */
  readonly webOrigin?: string;
}

/**
 * The owner's rule for mode `live` (2026-11-27): staging may send live replies with the mock ABN, for
 * testing; production refuses to boot in `live` until a real (checksum-valid) ABN and the contact
 * address are both configured. Exported for the test and the worker, which apply it the same way.
 */
export function liveRefusal(
  env: SpambankEnv,
  appEnv: SpambankConfigContext["appEnv"],
): string | null {
  if (env.SPAMBANK_AUTOREPLY_MODE !== "live" || appEnv !== "production") return null;
  const missing: string[] = [];
  if (env.SPAMBANK_SENDER_ABN === undefined || !isValidAbn(env.SPAMBANK_SENDER_ABN)) {
    missing.push("a real SPAMBANK_SENDER_ABN");
  }
  if (env.SPAMBANK_CONTACT_EMAIL === undefined) missing.push("SPAMBANK_CONTACT_EMAIL");
  return missing.length === 0
    ? null
    : `SPAMBANK_AUTOREPLY_MODE=live is refused in production without ${missing.join(" and ")} (Spam Act sender identity).`;
}

export function spambankConfigFrom(
  env: SpambankEnv,
  context: SpambankConfigContext = {},
): SpambankConfig {
  const secrets = [
    ["SPAMBANK_CREDENTIAL_KEY", env.SPAMBANK_CREDENTIAL_KEY],
    ["SPAMBANK_TOKEN_KEY", env.SPAMBANK_TOKEN_KEY],
    ["SPAMBANK_WEBHOOK_SECRET", env.SPAMBANK_WEBHOOK_SECRET],
    ["SPAMBANK_OPTOUT_KEY", env.SPAMBANK_OPTOUT_KEY],
  ] as const;
  // One leaked or reused key must not open the others: the credential key unlocks every mailbox.
  const seen = new Map<string, string>();
  for (const [name, value] of secrets) {
    if (value === undefined) continue;
    const other = seen.get(value);
    if (other !== undefined)
      throw new Error(`${name} and ${other} are the same value; each key must be its own.`);
    seen.set(value, name);
  }
  if (
    env.SPAMBANK_AUTOREPLY_MODE === "redirect" &&
    env.SPAMBANK_AUTOREPLY_REDIRECT_TO === undefined
  ) {
    throw new Error("SPAMBANK_AUTOREPLY_MODE=redirect needs SPAMBANK_AUTOREPLY_REDIRECT_TO.");
  }
  const sendsMail =
    env.SPAMBANK_AUTOREPLY_MODE === "redirect" || env.SPAMBANK_AUTOREPLY_MODE === "live";
  if (sendsMail && env.SPAMBANK_OPTOUT_KEY === undefined) {
    // Every reply carries a one-click opt-out (D2 5); without the key there is none to sign.
    throw new Error(
      `SPAMBANK_AUTOREPLY_MODE=${env.SPAMBANK_AUTOREPLY_MODE} needs SPAMBANK_OPTOUT_KEY.`,
    );
  }
  if (env.SPAMBANK_SENDER_ABN !== undefined && !isValidAbn(env.SPAMBANK_SENDER_ABN)) {
    throw new Error("SPAMBANK_SENDER_ABN is not a valid ABN (11 digits with the ATO checksum).");
  }
  const refusal = liveRefusal(env, context.appEnv);
  if (refusal !== null) throw new Error(refusal);
  const publicOrigin =
    context.webOrigin ??
    (context.appEnv === "staging" ? "https://yourtal.gaiada.com" : "http://localhost:3000");
  if (sendsMail && context.appEnv !== undefined && context.appEnv !== "dev") {
    if (!publicOrigin.startsWith("https://")) {
      throw new Error("Auto-replies outside dev need an https web origin for their opt-out links.");
    }
  }
  if (env.SPAMBANK_MAIL_DOMAIN === env.SPAMBANK_REPLY_DOMAIN) {
    throw new Error(
      "SPAMBANK_REPLY_DOMAIN must differ from SPAMBANK_MAIL_DOMAIN: its reputation is its own.",
    );
  }
  for (const origin of env.SPAMBANK_CORS_ORIGINS) {
    let normalised: string | undefined;
    try {
      normalised = new URL(origin).origin;
    } catch {
      normalised = undefined;
    }
    if (normalised !== origin || !origin.startsWith("https://")) {
      throw new Error(
        `SPAMBANK_CORS_ORIGINS entry "${origin.slice(0, 80)}" is not an https origin (no path, no trailing slash).`,
      );
    }
  }
  return {
    enabled: env.SPAMBANK_ENABLED,
    ...(env.SPAMBANK_STALWART_URL === undefined ? {} : { stalwartUrl: env.SPAMBANK_STALWART_URL }),
    ...(env.SPAMBANK_STALWART_API_KEY === undefined
      ? {}
      : { apiKey: env.SPAMBANK_STALWART_API_KEY }),
    ...(env.SPAMBANK_CREDENTIAL_KEY === undefined
      ? {}
      : { credentialKey: env.SPAMBANK_CREDENTIAL_KEY }),
    ...(env.SPAMBANK_TOKEN_KEY === undefined ? {} : { tokenKey: env.SPAMBANK_TOKEN_KEY }),
    ...(env.SPAMBANK_WEBHOOK_SECRET === undefined
      ? {}
      : { webhookSecret: env.SPAMBANK_WEBHOOK_SECRET }),
    ...(env.SPAMBANK_OPTOUT_KEY === undefined ? {} : { optoutKey: env.SPAMBANK_OPTOUT_KEY }),
    mailDomain: env.SPAMBANK_MAIL_DOMAIN,
    replyDomain: env.SPAMBANK_REPLY_DOMAIN,
    publicHost: env.SPAMBANK_PUBLIC_HOST,
    authservId: env.SPAMBANK_AUTHSERV_ID ?? env.SPAMBANK_PUBLIC_HOST,
    corsOrigins: env.SPAMBANK_CORS_ORIGINS,
    quotaBytes: env.SPAMBANK_QUOTA_BYTES,
    autoreply: {
      mode: env.SPAMBANK_AUTOREPLY_MODE,
      ...(env.SPAMBANK_AUTOREPLY_REDIRECT_TO === undefined
        ? {}
        : { redirectTo: env.SPAMBANK_AUTOREPLY_REDIRECT_TO }),
      dailyCap: env.SPAMBANK_AUTOREPLY_DAILY_CAP,
    },
    ownDomains: env.SPAMBANK_OWN_DOMAINS,
    alertEmails: env.SPAMBANK_ALERT_EMAILS,
    bannerUrl: env.SPAMBANK_BANNER_URL,
    sender: {
      abn: env.SPAMBANK_SENDER_ABN === undefined ? null : abnDigits(env.SPAMBANK_SENDER_ABN),
      contactEmail: env.SPAMBANK_CONTACT_EMAIL ?? DEFAULT_CONTACT_EMAIL,
      publicOrigin: new URL(publicOrigin).origin,
    },
    blocklist: {
      ips: env.SPAMBANK_BLOCKLIST_IPS,
      domains: env.SPAMBANK_BLOCKLIST_DOMAINS,
    },
  };
}
