"use client";

import { useRouter } from "next/navigation";
import type { Route } from "next";
import { useState } from "react";
import { useTranslations } from "next-intl";
import { Section } from "@yourtal/ui/section";
import { Switch } from "@yourtal/ui/switch";
import { Badge } from "@yourtal/ui/badge";
import { Text } from "@yourtal/ui/text";
import { Button } from "@yourtal/ui/button";
import type { ConsentEntry } from "@/features/me/me-schemas";
import { useMeActionStatus } from "@/features/me/use-me-action-status";
import { recordOnboardingConsentAction } from "./onboarding-actions";
import { recordOnboardingMark } from "./onboarding-timing";
import { withReturnTo } from "./onboarding-return-to";

export interface OnboardingConsentStepProps {
  initialConsents: readonly ConsentEntry[];
  returnTo: string | null;
}

type TogglePurpose = "declared_interest_targeting" | "marketing_communications";

function grantedFor(consents: readonly ConsentEntry[], purpose: TogglePurpose): boolean {
  return consents.find((entry) => entry.purpose === purpose)?.state === "granted";
}

/**
 * Per-purpose consent (6.2.b; docs/03-regulatory-and-risk.md section 2.3,
 * docs/24-legal-positions.md ID-7): three independent, plain-language
 * choices, never one blanket agreement. Real writes to
 * `POST /api/me/consents` (`source: "onboarding"`), the same
 * `latestPerPurpose` record Me's own consent section later reads and can
 * change — this step's choice is not a separate, onboarding-only setting.
 *
 * Essential (account/fraud prevention) has no toggle: its lawful basis is
 * `contract`, not consent, matching `MeConsentSection`. Continuing past
 * this step IS the essential consent (creating the account already needed
 * it) — there is nothing to record for a purpose that was never a choice.
 */
export function OnboardingConsentStep({ initialConsents, returnTo }: OnboardingConsentStepProps) {
  const t = useTranslations("onboarding.consent");
  const router = useRouter();
  const [consents, setConsents] = useState<readonly ConsentEntry[]>(initialConsents);
  const { status, run } = useMeActionStatus();

  function toggle(purpose: TogglePurpose, granted: boolean) {
    run(
      () => recordOnboardingConsentAction(purpose, granted),
      (data) => setConsents(data.consents),
    );
  }

  function handleContinue() {
    recordOnboardingMark("interests-start");
    const adTargeting = grantedFor(consents, "declared_interest_targeting");
    const next = adTargeting ? "/onboarding/interests" : "/onboarding/follow";
    router.push(withReturnTo(next, returnTo) as Route);
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

      <Button type="button" onClick={handleContinue}>
        {t("continueCta")}
      </Button>
    </Section>
  );
}
