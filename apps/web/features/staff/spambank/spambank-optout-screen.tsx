import { getTranslations } from "next-intl/server";
import { Heading } from "@yourtal/ui/heading";
import { Notice } from "@yourtal/ui/notice";
import { PageContainer } from "@yourtal/ui/page-container";
import { Text } from "@yourtal/ui/text";
import { readOptoutState } from "./spambank-optout-data";
import { SpambankOptoutConfirm } from "./spambank-optout-confirm";

/**
 * The public opt-out page (BUILD.md 4.6): who the visitor is stopping replies
 * for, one confirm button, and "already stopped" on a second visit. It never
 * changes anything on load, so a mail scanner that follows the link is harmless.
 */
export async function SpambankOptoutScreen({
  domain,
  sig,
}: {
  readonly domain: string;
  readonly sig: string;
}) {
  const t = await getTranslations("staff.spambank.optout");
  const state = await readOptoutState(domain, sig);

  return (
    <main className="min-h-dvh bg-canvas py-12">
      <PageContainer className="flex max-w-xl flex-col gap-6">
        {state === "invalid" ? (
          <>
            <Heading level={1} size="headline">
              {t("invalidTitle")}
            </Heading>
            <Text tone="muted">{t("invalid")}</Text>
          </>
        ) : state === "done" ? (
          <>
            <Heading level={1} size="headline">
              {t("alreadyTitle")}
            </Heading>
            <Notice tone="success">{t("already", { domain })}</Notice>
          </>
        ) : (
          <>
            <Heading level={1} size="headline">
              {t("title")}
            </Heading>
            <Text>{t("intro", { domain })}</Text>
            {state === "unavailable" ? (
              <Notice tone="warning">{t("unavailable")}</Notice>
            ) : (
              <>
                <SpambankOptoutConfirm domain={domain} sig={sig} />
                <Text size="caption" tone="muted">
                  {t("note")}
                </Text>
              </>
            )}
          </>
        )}
        <Text size="caption" tone="muted">
          {t("sender")}
        </Text>
      </PageContainer>
    </main>
  );
}
