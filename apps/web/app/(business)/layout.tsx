import type { ReactNode } from "react";
import { getLocale, getMessages } from "next-intl/server";
import { NextIntlClientProvider } from "next-intl";
import { readThemeCookie } from "@/lib/api/session-cookies";
import { RootDocument, baseMetadata, baseViewport } from "@/app/root-document";

export const metadata = baseMetadata;
export const viewport = baseViewport;

export interface BusinessLayoutProps {
  children: ReactNode;
}

/**
 * Root layout for YourTal Studio (task 7.8.a). A business account signs in
 * through the same `yt_session` cookie as the viewer app (`proxy.ts`
 * protects `/studio` exactly like `/home`), so this group is its own root
 * layout for the same reason `(merchant)`'s is: Next needs an `<html>`
 * somewhere, and this one is not nested under the viewer's `(app)` group.
 *
 * `getLocale()`/`getMessages()` resolve from the same region cookie
 * `(app)/layout.tsx` already reads (`i18n/request.ts`) — a business owner is
 * a person first, and a person belongs to exactly one region (CLAUDE.md),
 * so their account locale and their business's region always agree.
 *
 * Deliberately no `AppShell`/`RegionProvider`/`ServiceWorkerRegistrar`:
 * Studio is not a viewer surface, has its own chrome (`StudioChrome`,
 * composed per-page — see `studio-context.ts`'s comment on why this is not
 * a layout concern), and every Studio amount is formatted from the data's
 * own currency, never a viewer's region context (task 3.4.b's `MoneyAmount`).
 */
export default async function BusinessLayout({ children }: BusinessLayoutProps) {
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
