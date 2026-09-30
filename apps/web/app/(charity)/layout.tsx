import type { ReactNode } from "react";
import { getLocale, getMessages } from "next-intl/server";
import { NextIntlClientProvider } from "next-intl";
import { readThemeCookie } from "@/lib/api/session-cookies";
import { RootDocument, baseMetadata, baseViewport } from "@/app/root-document";

export const metadata = baseMetadata;
export const viewport = baseViewport;

/** 13.21: the charity registry's own root, like `(business)`'s: its pages are not viewer-shell screens. */
export default async function CharityLayout({ children }: { children: ReactNode }) {
  const locale = await getLocale();
  const messages = await getMessages();
  return (
    <RootDocument lang={locale} theme={await readThemeCookie()}>
      <NextIntlClientProvider locale={locale} messages={messages}>
        <main className="mx-auto flex min-h-dvh w-full max-w-4xl flex-col gap-6 bg-canvas px-4 py-8 text-fg sm:px-6">
          {children}
        </main>
      </NextIntlClientProvider>
    </RootDocument>
  );
}
