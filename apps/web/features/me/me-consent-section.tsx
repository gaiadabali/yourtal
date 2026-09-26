"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Section } from "@yourtal/ui/section";
import { Switch } from "@yourtal/ui/switch";
import { Badge } from "@yourtal/ui/badge";
import { Text } from "@yourtal/ui/text";
import type { ConsentEntry } from "./me-schemas";
import { updateConsentAction } from "./me-actions";
import { useMeActionStatus } from "./use-me-action-status";

export interface MeConsentSectionProps {
  initialConsents: readonly ConsentEntry[];
}

type TogglePurpose = "declared_interest_targeting" | "marketing_communications";

function grantedFor(consents: readonly ConsentEntry[], purpose: TogglePurpose): boolean {
  return consents.find((entry) => entry.purpose === purpose)?.state === "granted";
}

/**
 * `GET`/`POST /api/me/consents` (5.4.a/5.4.d): a withdrawal is a new
 * append-only record, never an edit (`consent.controller.ts`'s own doc
 * comment) — this widget only ever POSTs the caller's latest choice and
 * re-renders from the response, which is `latestPerPurpose` over the full
 * history. Essential (account + fraud prevention) has no toggle: its
 * lawful basis is `contract`/`legal_obligation`, not consent, so there is
 * nothing here for a switch to represent.
 */
export function MeConsentSection({ initialConsents }: MeConsentSectionProps) {
  const t = useTranslations("me.consent");
  const [consents, setConsents] = useState<readonly ConsentEntry[]>(initialConsents);
  const { status, run } = useMeActionStatus();

  function toggle(purpose: TogglePurpose, granted: boolean) {
    run(
      () => updateConsentAction(purpose, granted),
      (data) => setConsents(data.consents),
    );
  }

  return (
    <Section title={t("heading")} description={t("intro")}>
      <div className="flex items-start justify-between gap-4 rounded-card border border-border-subtle bg-surface-sunken p-4">
        <div className="flex flex-col gap-1">
          <Text size="label">{t("essentialTitle")}</Text>
          <Text size="body-sm" tone="muted">
            {t("essentialBody")}
          </Text>
        </div>
        <Badge variant="secondary">{t("essentialLockedBadge")}</Badge>
      </div>

      <div className="flex items-start justify-between gap-4 rounded-card border border-border-subtle bg-surface p-4">
        <div className="flex flex-col gap-1">
          <Text size="label" as="label">
            {t("personalizeTitle")}
          </Text>
          <Text size="body-sm" tone="muted">
            {t("personalizeBody")}
          </Text>
        </div>
        <Switch
          label={t("personalizeTitle")}
          hideLabel
          checked={grantedFor(consents, "declared_interest_targeting")}
          onCheckedChange={(checked) => toggle("declared_interest_targeting", checked)}
        />
      </div>

      <div className="flex items-start justify-between gap-4 rounded-card border border-border-subtle bg-surface p-4">
        <div className="flex flex-col gap-1">
          <Text size="label" as="label">
            {t("marketingTitle")}
          </Text>
          <Text size="body-sm" tone="muted">
            {t("marketingBody")}
          </Text>
        </div>
        <Switch
          label={t("marketingTitle")}
          hideLabel
          checked={grantedFor(consents, "marketing_communications")}
          onCheckedChange={(checked) => toggle("marketing_communications", checked)}
        />
      </div>

      {status.kind === "error" ? (
        <Text size="body-sm" tone="danger" role="alert">
          {status.message}
        </Text>
      ) : null}
    </Section>
  );
}
