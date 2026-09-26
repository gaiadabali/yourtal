"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Section } from "@yourtal/ui/section";
import { Button } from "@yourtal/ui/button";
import { Text } from "@yourtal/ui/text";
import { issueLinkCodeAction } from "./me-actions";
import { useMeActionStatus } from "./use-me-action-status";

/**
 * `POST /api/me/linked-apps/code` (5.4.c): a fresh, single-use, 10-minute
 * code every call by design (`linked-apps.controller.ts`'s own doc
 * comment on why this is never `@Idempotent`) — so this widget always
 * shows the LATEST code it issued, never a cached one, and issuing again
 * replaces it. Consuming the code in snap-app is 8.4, not built.
 */
export function MeLinkedAppsSection() {
  const t = useTranslations("me.linkedApps");
  const [issued, setIssued] = useState<{ code: string; expiresAt: string } | null>(null);
  const { status, isPending, run } = useMeActionStatus();

  function handleGenerate() {
    run(
      () => issueLinkCodeAction(),
      (data) => setIssued(data),
    );
  }

  return (
    <Section title={t("heading")} description={t("intro")}>
      <div className="flex flex-col gap-3">
        <Button
          type="button"
          variant="secondary"
          onClick={handleGenerate}
          disabled={isPending}
          className="self-start"
        >
          {t("generateCta")}
        </Button>
        {issued ? (
          <div className="rounded-card border border-border-subtle bg-surface-sunken p-4">
            <Text size="body-sm" tone="muted">
              {t("codeLabel")}
            </Text>
            <Text size="body" numeric className="font-mono text-title tracking-widest">
              {issued.code}
            </Text>
            <Text size="caption" tone="muted">
              {t("expiresPrefix")} {new Date(issued.expiresAt).toLocaleTimeString()}
            </Text>
          </div>
        ) : null}
        {status.kind === "error" ? (
          <Text size="body-sm" tone="danger" role="alert">
            {status.message}
          </Text>
        ) : null}
      </div>
    </Section>
  );
}
