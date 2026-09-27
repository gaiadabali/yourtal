import type { ReactNode } from "react";
import type { Metadata } from "next";
import { getLocale, getMessages } from "next-intl/server";
import { NextIntlClientProvider } from "next-intl";
import { RootDocument, baseMetadata, baseViewport } from "@/app/root-document";

// Internal tooling: never indexed, whatever the environment.
export const metadata: Metadata = { ...baseMetadata, robots: { index: false, follow: false } };
export const viewport = baseViewport;

/** Root layout for the internal staff console (TASKS.md 9.1), its own root like `(business)`. */
export default async function StaffRootLayout({ children }: { children: ReactNode }) {
  const locale = await getLocale();
  const messages = await getMessages();
  return (
    <RootDocument lang={locale}>
      <NextIntlClientProvider locale={locale} messages={messages}>
        {children}
      </NextIntlClientProvider>
    </RootDocument>
  );
}
