import type { ReactNode } from "react";
import { getMessages } from "next-intl/server";
import { NextIntlClientProvider } from "next-intl";
import { readThemeCookie } from "@/lib/api/session-cookies";
import { getDisplayLocale } from "@/i18n/get-locale";
import { GodCompanyFooter } from "@/features/god-bar/god-company-footer";
import { RootDocument, baseMetadata, baseViewport } from "@/app/root-document";

export const metadata = baseMetadata;
export const viewport = baseViewport;

export interface AuthLayoutProps {
  children: ReactNode;
}

/**
 * Root layout for the (auth) group (6.2.a): register, login, forgot, reset,
 * verify, each one `<main>` via `AuthCard`, with the "A GOD company" footer here. No `AppShell`/`RegionProvider` — none of these screens has a
 * signed-in region yet (register is what CREATES one) — but they still
 * need `NextIntlClientProvider` so `RegisterForm`'s client-side
 * `useTranslations` has messages to read, the same boundary
 * `(app)/layout.tsx` draws for its own tree.
 */
export default async function AuthLayout({ children }: AuthLayoutProps) {
  const locale = await getDisplayLocale();
  const messages = await getMessages();
  return (
    <RootDocument lang={locale} theme={await readThemeCookie()}>
      <NextIntlClientProvider locale={locale} messages={messages}>
        <div className="flex min-h-screen flex-col">
          <div className="flex flex-1 flex-col">{children}</div>
          <GodCompanyFooter locale={locale} />
        </div>
      </NextIntlClientProvider>
    </RootDocument>
  );
}
