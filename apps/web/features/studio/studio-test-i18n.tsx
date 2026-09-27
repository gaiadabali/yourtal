import type { ReactNode } from "react";
import { NextIntlClientProvider } from "next-intl";
import enAU from "@/messages/en-AU/studio.json";

/**
 * Test-only wrapper supplying the `studio` message catalogue so Client
 * Components under test can call `useTranslations("studio")` without
 * `NextIntlClientProvider was not found` (see `burn-summary.test.tsx` for
 * the same pattern in `features/burn`). Tests assert the literal en-AU
 * strings, so this always renders with `en-AU` — Studio itself is not
 * region-switched the way the consumer app is.
 */
export function StudioIntlProvider({ children }: { children: ReactNode }) {
  return (
    <NextIntlClientProvider locale="en-AU" messages={{ studio: enAU }}>
      {children}
    </NextIntlClientProvider>
  );
}
