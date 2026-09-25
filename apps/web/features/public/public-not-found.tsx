import { Heading } from "@yourtal/ui/heading";
import { Text } from "@yourtal/ui/text";
import { getPublicTranslator } from "./public-i18n";
import { PublicCtaLink } from "./public-cta-link";

/**
 * The branded 404. A not-found boundary never sees the `[locale]` segment,
 * so it speaks English (the default) with an Indonesian line beneath.
 */
export function PublicNotFound() {
  const en = getPublicTranslator("en-AU");
  const id = getPublicTranslator("id-ID");
  return (
    <div className="flex flex-col items-start gap-6 py-12">
      <p aria-hidden="true" className="font-display text-display-lg text-accent">
        404
      </p>
      <div className="flex flex-col gap-2">
        <Heading level={1} size="display">
          {en("notFound.heading")}
        </Heading>
        <Text tone="muted">{en("notFound.body")}</Text>
      </div>
      <div className="flex flex-wrap items-center gap-4">
        <PublicCtaLink href="/au">{en("notFound.homeLink")}</PublicCtaLink>
        <a href="/au/rewards" className="text-label font-medium text-fg hover:underline">
          {en("notFound.rewardsLink")}
        </a>
      </div>
      <div lang="id-ID" className="flex flex-col gap-1 border-t border-border-subtle pt-4">
        <Text size="body-sm">{id("notFound.heading")}</Text>
        <a href="/id" className="text-body-sm font-medium text-fg hover:underline">
          {id("notFound.homeLink")}
        </a>
      </div>
    </div>
  );
}
