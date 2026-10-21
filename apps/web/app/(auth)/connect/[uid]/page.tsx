import type { Metadata } from "next";
import { NextIntlClientProvider } from "next-intl";
import type { DisplayLocale } from "@yourtal/contracts/identity/user-profile";
import { loadInteraction } from "@/features/connect/connect-api";
import type { LoadedInteraction } from "@/features/connect/connect-api";
import { pickConnectLocale } from "@/features/connect/connect-locale";
import { ConnectEndedView, ConnectUnavailableView } from "@/features/connect/connect-notice-views";
import { ConnectScreen } from "@/features/connect/connect-screen";
import { isInteractionUid } from "@/features/connect/connect-uid";
import { getDisplayLocale } from "@/i18n/get-locale";
import enAU from "@/messages/en-AU/connect.json";
import idID from "@/messages/id-ID/connect.json";

/** Never cached: the page is one person's sign-in, read with their cookies. */
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  robots: { index: false, follow: false },
  // The address carries the sign-in's id, so links off this page send no referrer.
  referrer: "no-referrer",
};

const CATALOGUES: Record<DisplayLocale, typeof enAU> = { "en-AU": enAU, "id-ID": idID };

export interface ConnectPageProps {
  params: Promise<{ uid: string }>;
}

/**
 * `/connect/[uid]` (docs/26 §1.1): where the provider sends the browser to
 * sign in, agree and be turned away. The details are fetched here, on the
 * server, with the interaction cookies the browser sent to this path; the
 * client components below only ever see what the screen shows.
 */
export default async function ConnectPage({ params }: ConnectPageProps) {
  const { uid } = await params;
  const personsLocale = await getDisplayLocale();
  const loaded: LoadedInteraction = isInteractionUid(uid)
    ? await loadInteraction(uid)
    : { kind: "ended" };
  // The app's `ui_locales` first, then the person's own language.
  const locale =
    loaded.kind === "ok"
      ? pickConnectLocale(loaded.details.uiLocales, personsLocale)
      : personsLocale;

  return (
    <NextIntlClientProvider locale={locale} messages={{ connect: CATALOGUES[locale] }}>
      <div lang={locale}>
        {loaded.kind === "ok" ? (
          <ConnectScreen key={loaded.details.screen} details={loaded.details} />
        ) : loaded.kind === "ended" ? (
          <ConnectEndedView />
        ) : (
          <ConnectUnavailableView />
        )}
      </div>
    </NextIntlClientProvider>
  );
}
