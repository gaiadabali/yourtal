"use client";

import { useTranslations } from "next-intl";
import { Section } from "@yourtal/ui/section";
import { ErrorState } from "@yourtal/ui/error-state";
import { Button } from "@yourtal/ui/button";
import type { ApiError } from "@/lib/api/api-fetch";

/**
 * The shared "this section's own fetch failed" render every Me widget uses
 * (6.7.a: "error and API-down states", per section rather than one blanket
 * page-level fallback — see `page.tsx`'s doc comment for why each section
 * gets its own `ApiResult` instead of one `Promise.all().catch()` that
 * fails the whole page). The page's own `loading.tsx` covers the initial
 * navigation's loading state (Next's file convention); there is no
 * per-section loading render here because every read this page needs
 * already resolves before the Server Component returns.
 */

export interface MeSectionErrorProps {
  title: string;
  error: ApiError;
}

/** Signed-out gets its own copy (a real, expected state — not a fault); every other ApiError gets the generic one. */
export function MeSectionError({ title, error }: MeSectionErrorProps) {
  const t = useTranslations("me.common");
  const isSignedOut = error.kind === "http" && error.status === 401;
  return (
    <Section title={title}>
      <ErrorState
        title={isSignedOut ? t("signedOutTitle") : t("errorTitle")}
        description={isSignedOut ? t("signedOutBody") : t("errorBody")}
        retry={
          isSignedOut ? undefined : (
            <Button variant="secondary" size="sm" onClick={() => window.location.reload()}>
              {t("retryCta")}
            </Button>
          )
        }
      />
    </Section>
  );
}
