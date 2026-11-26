import type { MailSummaryResponse } from "@yourtal/contracts/spambank/mail";
import type { MailPrincipal } from "../proxy/mail-auth";
import type { ProxyContext } from "../proxy/proxy-context";
import { USING_MAIL, callAs, isProblem, roleIds, sessionOf } from "./account-jmap";

/**
 * `GET /api/spambank/mail/summary?locale=` (spambank/BUILD.md §4.13): the YourTal banner every mail
 * UI shows on top of Spam, the counters, and the two folder ids the UIs need to tell Spam (the
 * `junk`-role mailbox) from Junk (the custom one, §4.2).
 *
 * The banner copy lives here, not in apps/web's catalogues, because three apps on three stacks show
 * it. id-ID is written for Indonesian readers, not translated word for word (owner review pending).
 */

type Banner = Omit<MailSummaryResponse["banner"], "ctaUrl">;

export const BANNER_COPY: Readonly<Record<"en-AU" | "id-ID", Banner>> = {
  "en-AU": {
    title: "Run a business? Reach people who want to hear from you",
    body: "On YourTal, people choose the brands they watch and earn points for it. No inbox required.",
    ctaLabel: "Advertise on YourTal",
  },
  "id-ID": {
    title: "Punya usaha? Jangkau orang yang memang mau dengar kabar dari Anda",
    body: "Di YourTal, orang memilih sendiri brand yang ingin mereka tonton, dan dapat poin dari situ. Tanpa perlu masuk inbox.",
    ctaLabel: "Beriklan di YourTal",
  },
};

export function bannerLocale(locale: unknown): "en-AU" | "id-ID" {
  return typeof locale === "string" && /^id\b/i.test(locale) ? "id-ID" : "en-AU";
}

export async function summaryFor(
  ctx: ProxyContext,
  principal: MailPrincipal,
  locale: unknown,
): Promise<MailSummaryResponse> {
  const counters = await ctx.store.counters(principal.mailboxId);
  // The Spam id is a convenience: a mail server that is down costs it, not the banner.
  let spamMailboxId: string | null = null;
  const session = await sessionOf(ctx, principal);
  if (!isProblem(session)) {
    const answers = await callAs(ctx, principal, USING_MAIL, [
      ["Mailbox/get", { accountId: session.accountId, ids: null, properties: ["id", "role"] }, "m"],
    ]);
    if (!isProblem(answers)) spamMailboxId = roleIds(answers.get("m")).get("junk") ?? null;
  }
  return {
    address: principal.address,
    folders: { spamMailboxId, junkMailboxId: principal.junkMailboxId },
    counters,
    banner: { ...BANNER_COPY[bannerLocale(locale)], ctaUrl: ctx.config.bannerUrl },
  };
}
