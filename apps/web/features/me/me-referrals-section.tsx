"use client";

import { useState } from "react";
import { Button } from "@yourtal/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@yourtal/ui/card";
import { readOrCreateReferralCode } from "./me-referral-code";
import { getMeTranslator, type SupportedLocale } from "./me-i18n";

export interface MeReferralsSectionProps {
  locale: SupportedLocale;
}

/**
 * Referrals. `me-referral-code.ts`'s docstring explains the gap this
 * section states rather than papers over: no referral contract or backend
 * exists yet, so the code itself is real and copyable but referral point
 * rewards are explicitly labelled not-yet-available — never a fabricated
 * "earn 500 points per referral" line the economy (docs/09's "unfunded
 * faucets" trap) has not decided how to fund.
 */
export function MeReferralsSection({ locale }: MeReferralsSectionProps) {
  const t = getMeTranslator(locale);
  const [referralCode] = useState(() => readOrCreateReferralCode());
  const [copied, setCopied] = useState(false);

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(referralCode);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard permission denied or unavailable — the code is still shown on screen to copy by hand.
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle as="h2">{t("referrals.heading")}</CardTitle>
        <p className="text-sm font-sans text-fg-muted">{t("referrals.intro")}</p>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <div className="flex items-center justify-between gap-3 rounded-lg border border-border bg-surface p-4">
          <div>
            <p className="text-xs font-sans text-fg-muted">{t("referrals.codeLabel")}</p>
            <p className="font-mono text-lg font-semibold tracking-wide text-fg">{referralCode}</p>
          </div>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={() => {
              void handleCopy();
            }}
          >
            {copied ? t("referrals.copiedConfirmation") : t("referrals.copyCta")}
          </Button>
        </div>
        <p className="text-xs font-sans text-fg-subtle">{t("referrals.rewardsNotAvailable")}</p>
      </CardContent>
    </Card>
  );
}
