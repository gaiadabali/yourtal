import type { Metadata } from "next";
import { AuthCard } from "@/features/auth/auth-card";
import { GuardianInvalidNotice } from "@/features/guardian/guardian-invalid-notice";
import { getGuardianTranslator } from "@/features/guardian/guardian-i18n";

export const metadata: Metadata = { robots: { index: false, follow: false } };

/**
 * `notFound()` from `page.tsx` when `GET /api/guardian/:token` 404s
 * (12.2.c's own "no enumeration oracle" 404, `guardian-consent.controller.ts`'s
 * own header) lands here — a real HTTP 404, not a 200 rendering an error
 * message, and a plain "this link isn't valid" rather than the branded
 * `global-not-found.tsx`: a guardian following a stale or mistyped link has
 * no account and no context for YourTal's own 404 page's copy.
 */
export default function GuardianTokenNotFound() {
  const t = getGuardianTranslator("en-AU");
  return (
    <AuthCard title={t("invalid.heading")}>
      <GuardianInvalidNotice />
    </AuthCard>
  );
}
