import { DEFAULT_MAIL_DOMAIN, DEFAULT_REPLY_DOMAIN } from "@yourtal/drivers/spambank";
import type { SpambankDriver } from "@yourtal/drivers/spambank";

/**
 * `node worker/dist/main.js --spambank-ping`: asks Stalwart which domains it serves (`x:Domain/get`,
 * the management call) and checks both Spambank domains are there. Run by hand on the box after a
 * deploy; deliberately NOT part of the boot check, because a mail server that is down must never fail
 * a deploy (spambank/BUILD.md T2). Prints the verdict, never a credential.
 */
export interface PingResult {
  readonly ok: boolean;
  readonly lines: readonly string[];
}

function nonBlank(value: string | undefined, fallback: string): string {
  const trimmed = value?.trim();
  return trimmed === undefined || trimmed === "" ? fallback : trimmed;
}

export async function pingSpambank(
  driver: SpambankDriver,
  env: Readonly<Record<string, string | undefined>>,
): Promise<PingResult> {
  const expected = [
    nonBlank(env.SPAMBANK_MAIL_DOMAIN, DEFAULT_MAIL_DOMAIN),
    nonBlank(env.SPAMBANK_REPLY_DOMAIN, DEFAULT_REPLY_DOMAIN),
  ];
  const lines = [`[spambank-ping] driver=${driver.mode}`];
  const result = await driver.listDomains();
  if (result.isErr()) {
    return {
      ok: false,
      lines: [...lines, `[spambank-ping] FAILED (${result.error.code}): ${result.error.detail}`],
    };
  }
  const names = result.value.map((domain) => domain.name.toLowerCase());
  lines.push(`[spambank-ping] stalwart serves: ${names.join(", ") || "(none)"}`);
  const missing = expected.filter((name) => !names.includes(name.toLowerCase()));
  if (missing.length > 0) {
    return {
      ok: false,
      lines: [...lines, `[spambank-ping] FAILED: missing ${missing.join(", ")}`],
    };
  }
  return { ok: true, lines: [...lines, "[spambank-ping] ok: both Spambank domains are served"] };
}
