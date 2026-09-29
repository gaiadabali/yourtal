import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { AuthCard } from "@/features/auth/auth-card";
import { getGuardianConsent } from "@/features/guardian/guardian-api";
import { getGuardianTranslator } from "@/features/guardian/guardian-i18n";
import { GuardianApproveForm } from "@/features/guardian/guardian-approve-form";
import { GuardianGrantedPanel } from "@/features/guardian/guardian-granted-panel";
import { GuardianRevokedNotice } from "@/features/guardian/guardian-revoked-notice";
import { GuardianErrorNotice } from "@/features/guardian/guardian-error-notice";

// Always noindex, in every environment — unlike `baseMetadata`'s
// staging-only `robots`, this page can carry a real teen's real display
// name in production and must never be indexable, staging or not.
export const metadata: Metadata = { robots: { index: false, follow: false } };

export interface GuardianPageProps {
  params: Promise<{ token: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

/**
 * `/guardian/[token]` (12.2.c) — the guardian consent page. No locale
 * segment (the email links to exactly this path, per the ticket's brief)
 * and no session: the token alone is the credential
 * (`guardian-consent.controller.ts`'s own header), so this reads no
 * cookie anywhere in its tree — see `guardian-api.ts` and this route's own
 * `layout.tsx` for where that discipline is enforced.
 *
 * `GET /api/guardian/:token`'s own `locale` field (the TEEN's display
 * locale, not the guardian's browser) picks which catalogue
 * `getGuardianTranslator` reads — there is no other signal available for a
 * page with no session and no `[locale]` segment.
 *
 * A 404 from the GET (unknown/never-issued token) calls `notFound()`,
 * rendering this segment's own `not-found.tsx` — a real HTTP 404, not a
 * 200 with an error message. Any OTHER failure (network, 5xx, a body that
 * fails its own contract) is treated as transient instead: `error.*`,
 * with a retry, not a 404 — the token might be perfectly valid and the API
 * just unreachable this one time.
 */
export default async function GuardianPage({ params, searchParams }: GuardianPageProps) {
  const { token } = await params;
  const query = await searchParams;
  const action = typeof query["action"] === "string" ? query["action"] : undefined;

  const result = await getGuardianConsent(token);

  if (!result.ok) {
    if (result.error.kind === "http" && result.error.code === "not_found") {
      notFound();
    }
    const t = getGuardianTranslator("en-AU");
    return (
      <AuthCard title={t("error.heading")}>
        <GuardianErrorNotice />
      </AuthCard>
    );
  }

  const view = result.data;
  const t = getGuardianTranslator(view.locale);
  // Minted once per render, not per click — a retried submit of the SAME
  // rendered form reuses this key, so the API's `Idempotency-Key` guard
  // actually catches a double-submit rather than seeing two fresh calls.
  const idempotencyKey = crypto.randomUUID();

  if (view.status === "pending") {
    return (
      <AuthCard title={t("pending.heading", { displayName: view.displayName })}>
        <GuardianApproveForm
          token={token}
          displayName={view.displayName}
          locale={view.locale}
          idempotencyKey={idempotencyKey}
        />
      </AuthCard>
    );
  }

  if (view.status === "granted") {
    return (
      <AuthCard title={t("granted.heading", { displayName: view.displayName })}>
        <GuardianGrantedPanel
          token={token}
          displayName={view.displayName}
          locale={view.locale}
          idempotencyKey={idempotencyKey}
          openConfirmOnMount={action === "revoke"}
        />
      </AuthCard>
    );
  }

  // "revoked" — final; nothing further can be done with this link.
  return (
    <AuthCard title={t("revoked.heading")}>
      <GuardianRevokedNotice displayName={view.displayName} locale={view.locale} />
    </AuthCard>
  );
}
