"use client";

import type { ReactNode } from "react";
import { useTranslations } from "next-intl";
import { Card, CardContent, CardHeader, CardTitle } from "@yourtal/ui/card";

const CODE = (chunks: ReactNode) => (
  <code className="rounded bg-surface-sunken px-1 font-mono text-xs">{chunks}</code>
);

/**
 * TASKS.md 8.3.a's documentation page — the same content
 * `packages/sdk-merchant/README.md` gives an engineer integrating directly,
 * condensed for this card. Kept in sync by hand for now (both are short);
 * if they drift, the SDK README is the source of truth (it is what a real
 * integration is built against).
 *
 * A client leaf (not `studio-i18n.ts`'s server-only `getStudioTranslator`,
 * whose `LooseTranslator` type deliberately drops `.rich()` — see that
 * file's own doc comment) purely so the inline `<code>` tags below can
 * come from next-intl's real `useTranslations`, which still supports it.
 * No other interactivity lives here.
 */
export function DeveloperDocsPanel({ baseUrl }: { baseUrl: string }) {
  const t = useTranslations("studio");
  return (
    <Card>
      <CardHeader>
        <CardTitle as="h2">{t("developers.docs.title")}</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4 text-sm font-sans text-fg">
        <section className="flex flex-col gap-1">
          <h3 className="font-semibold text-fg">{t("developers.docs.baseUrlTitle")}</h3>
          <p className="text-fg-muted">
            {t.rich("developers.docs.baseUrlBody", { code: CODE, url: baseUrl })}
          </p>
        </section>
        <section className="flex flex-col gap-1">
          <h3 className="font-semibold text-fg">{t("developers.docs.signingTitle")}</h3>
          <p className="text-fg-muted">{t.rich("developers.docs.signingBody", { code: CODE })}</p>
        </section>
        <section className="flex flex-col gap-1">
          <h3 className="font-semibold text-fg">{t("developers.docs.callsTitle")}</h3>
          <ul className="list-disc pl-5 text-fg-muted">
            <li>{t.rich("developers.docs.callAuthorize", { code: CODE })}</li>
            <li>{t.rich("developers.docs.callCapture", { code: CODE })}</li>
            <li>{t.rich("developers.docs.callVoid", { code: CODE })}</li>
            <li>{t.rich("developers.docs.callRefund", { code: CODE })}</li>
          </ul>
          <p className="text-fg-muted">{t("developers.docs.callsDeviceNote")}</p>
        </section>
        <section className="flex flex-col gap-1">
          <h3 className="font-semibold text-fg">{t("developers.docs.errorsTitle")}</h3>
          <p className="text-fg-muted">{t.rich("developers.docs.errorsBody", { code: CODE })}</p>
        </section>
        <section className="flex flex-col gap-1">
          <h3 className="font-semibold text-fg">{t("developers.docs.idempotencyTitle")}</h3>
          <p className="text-fg-muted">
            {t.rich("developers.docs.idempotencyBody", { code: CODE })}
          </p>
        </section>
      </CardContent>
    </Card>
  );
}
