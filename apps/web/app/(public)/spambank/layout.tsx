import type { ReactNode } from "react";
import type { Metadata } from "next";
import { getLocale, getMessages } from "next-intl/server";
import { NextIntlClientProvider } from "next-intl";
import { readThemeCookie } from "@/lib/api/session-cookies";
import { RootDocument, baseMetadata, baseViewport } from "@/app/root-document";

// The opt-out link carries a signature, so it is never indexed and never leaves in a Referer header.
export const metadata: Metadata = {
  ...baseMetadata,
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};
export const viewport = baseViewport;

/**
 * Root layout for the public Spambank pages (BUILD.md 4.6): a sibling of
 * `[locale]` under `(public)`, because the link in an auto-reply carries no
 * locale. The language is the visitor's display language (cookie, then the
 * region default), like the other cookie-aware groups.
 */
export default async function SpambankPublicLayout({ children }: { children: ReactNode }) {
  const locale = await getLocale();
  const messages = await getMessages();
  return (
    <RootDocument lang={locale} theme={await readThemeCookie()}>
      <NextIntlClientProvider locale={locale} messages={messages}>
        {children}
      </NextIntlClientProvider>
    </RootDocument>
  );
}
