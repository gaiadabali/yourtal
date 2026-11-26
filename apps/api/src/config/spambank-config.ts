import { z } from "zod";
import { AUTOREPLY_MODES } from "@yourtal/contracts/spambank/common";
import type { AutoreplyMode } from "@yourtal/contracts/spambank/common";

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
};

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
}

export function spambankConfigFrom(env: SpambankEnv): SpambankConfig {
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
  };
}
