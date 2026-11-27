"use client";

import { ArrowUpRight } from "lucide-react";
import { useTranslations } from "next-intl";
import type { MailSummary } from "@yourtal/mail-engine";
import { useMailSummary } from "@yourtal/mail-engine/react";
import { Button } from "@yourtal/ui/button";
import { Heading } from "@yourtal/ui/heading";
import { Text } from "@yourtal/ui/text";
import { safeHttpsUrl } from "./mail-text";
import { useMailLocale } from "./mail-ui";

/**
 * The YourTal ad and the three counters, shown at the top of Spam (BUILD.md section 4.13).
 *
 * The title, body and button label come from the server and are shown as plain text. The button is
 * drawn only when its address is plain https. A missing banner still shows the counters, and a
 * missing summary shows nothing: this is an extra, not something the folder should wait for.
 */
export function SpamBannerView({
  summary,
  locale,
}: {
  summary: MailSummary | null;
  locale: string;
}) {
  const t = useTranslations("spambank.banner");
  if (!summary) return null;
  const { banner, counters } = summary;
  const href = safeHttpsUrl(banner?.ctaUrl);
  const nf = new Intl.NumberFormat(locale);
  const stats = [
    [t("bulkFiled"), counters.bulkFiled30d],
    [t("unsubscribed"), counters.marketersUnsubscribed],
    [t("autoReplies"), counters.autoRepliesSent30d],
  ] as const;
  return (
    <section
      aria-label={t("label")}
      data-testid="spam-banner"
      className="mb-4 overflow-hidden rounded-card border border-border-subtle bg-accent-subtle"
    >
      {banner ? (
        <div className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between sm:gap-6">
          <div className="min-w-0">
            <Text size="caption" tone="accent" className="font-bold uppercase tracking-wide">
              {t("from")}
            </Text>
            <Heading level={3} size="title" className="mt-1">
              {banner.title}
            </Heading>
            <Text size="body-sm" tone="muted" className="mt-1 max-w-[62ch]">
              {banner.body}
            </Text>
          </div>
          {href ? (
            <Button asChild className="shrink-0 self-start sm:self-center">
              <a href={href} target="_blank" rel="noopener noreferrer">
                {banner.ctaLabel}
                <ArrowUpRight aria-hidden="true" className="size-4" />
              </a>
            </Button>
          ) : null}
        </div>
      ) : null}
      <dl className="grid grid-cols-3 gap-px border-t border-border-subtle bg-border-subtle text-center">
        {stats.map(([label, value]) => (
          <div key={label} className="bg-surface px-2 py-3">
            <dd className="text-title font-sans font-semibold tabular-nums text-fg">
              {nf.format(value)}
            </dd>
            <dt className="mt-0.5 text-caption font-sans text-fg-muted">{label}</dt>
          </div>
        ))}
      </dl>
    </section>
  );
}

export function SpamBanner() {
  const locale = useMailLocale();
  const { summary } = useMailSummary(locale);
  return <SpamBannerView summary={summary} locale={locale} />;
}
