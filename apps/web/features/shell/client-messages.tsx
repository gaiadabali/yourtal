import type { ReactNode } from "react";
import { NextIntlClientProvider } from "next-intl";
import { getLocale, getMessages } from "next-intl/server";

/**
 * 13.4.a: the strings every viewer page's client code needs: the shell, feed
 * cards, category labels, and the app-wide error boundary.
 */
export const BASE_CLIENT_NAMESPACES = ["shell", "feed", "taxonomy", "campaign"] as const;

/**
 * Sends only the namespaces a section's client components translate, so a page
 * does not carry every catalogue in its HTML ahead of its first paint. A nested
 * provider replaces the outer one, so the base set is always included.
 */
export async function ClientMessages({
  namespaces = [],
  children,
}: {
  namespaces?: readonly string[];
  children: ReactNode;
}) {
  const [locale, messages] = await Promise.all([getLocale(), getMessages()]);
  const picked = Object.fromEntries(
    [...BASE_CLIENT_NAMESPACES, ...namespaces]
      .filter((ns) => ns in messages)
      .map((ns) => [ns, messages[ns]]),
  );
  return (
    <NextIntlClientProvider locale={locale} messages={picked}>
      {children}
    </NextIntlClientProvider>
  );
}
