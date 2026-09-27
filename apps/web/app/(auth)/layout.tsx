import type { ReactNode } from "react";
import { getLocale, getMessages } from "next-intl/server";
import { NextIntlClientProvider } from "next-intl";
import { RootDocument, baseMetadata, baseViewport } from "@/app/root-document";

export const metadata = baseMetadata;
export const viewport = baseViewport;

export interface AuthLayoutProps {
  children: ReactNode;
}

/**
 * Root layout for the (auth) group (6.2.a): register, login, forgot, reset,
 * verify. No `AppShell`/`RegionProvider` — none of these screens has a
 * signed-in region yet (register is what CREATES one) — but they still
 * need `NextIntlClientProvider` so `RegisterForm`'s client-side
 * `useTranslations` has messages to read, the same boundary
 * `(app)/layout.tsx` draws for its own tree.
 */
export default async function AuthLayout({ children }: AuthLayoutProps) {
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
