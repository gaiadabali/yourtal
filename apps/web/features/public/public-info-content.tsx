import { Heading } from "@yourtal/ui/heading";
import { Notice } from "@yourtal/ui/notice";
import { Section } from "@yourtal/ui/section";
import { Text } from "@yourtal/ui/text";
import type { SupportedLocale } from "./public-i18n";
import { getPublicTranslator } from "./public-i18n";
import type { PublicInfoPage } from "./public-info-pages";
import { PublicCtaLink } from "./public-cta-link";

export interface PublicInfoContentProps {
  page: PublicInfoPage;
  locale: SupportedLocale;
  /** Legal pages say they are drafts while on staging. */
  showDraftNotice: boolean;
}

export function PublicInfoContent({ page, locale, showDraftNotice }: PublicInfoContentProps) {
  const t = getPublicTranslator(locale);
  return (
    <article className="flex max-w-prose flex-col gap-8">
      <header className="flex flex-col gap-3">
        <Heading level={1} size="display">
          {page.title}
        </Heading>
        <Text tone="muted">{page.lead}</Text>
        {showDraftNotice ? (
          <Notice tone="info" title={t("draftNotice.title")}>
            <p>{t("draftNotice.body")}</p>
          </Notice>
        ) : null}
      </header>
      {page.sections.map((section) => (
        <Section key={section.heading} title={section.heading}>
          {section.body.map((paragraph) => (
            <Text key={paragraph} tone="muted">
              {paragraph}
            </Text>
          ))}
        </Section>
      ))}
      {page.cta ? (
        <div>
          <PublicCtaLink href={page.cta.href}>{page.cta.label}</PublicCtaLink>
        </div>
      ) : null}
    </article>
  );
}
