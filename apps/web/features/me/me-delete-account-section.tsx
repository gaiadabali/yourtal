"use client";

import { useState } from "react";
import { Button } from "@yourtal/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@yourtal/ui/card";
import { clearConsentPreferences } from "./me-consent-store";
import { clearInterestIds } from "./me-interests-store";
import { clearPasskeyEnrolled } from "./me-security-store";
import { clearReferralCode } from "./me-referral-code";
import { getMeTranslator, type SupportedLocale } from "./me-i18n";

export interface MeDeleteAccountSectionProps {
  locale: SupportedLocale;
}

type DeleteStep = "idle" | "confirming" | "completed";

/**
 * The account-deletion path (YT-0433: "present and honest about what
 * happens to points"). Points are a liability the platform owes the user
 * (docs/09-points-economy-and-redemption.md §5), and there is no cash-out
 * mechanism in either jurisdiction (docs/24-legal-positions.md AU-2/ID-2:
 * "no cash withdrawal, in either market, until licensed"), so the only
 * honest answer is that unspent points — available, on hold in holdback, or
 * about to expire — are forfeited outright, stated in plain language BEFORE
 * the irreversible action, not buried after it or omitted.
 *
 * Vouchers are a separate, already-issued bearer instrument
 * (`@yourtal/contracts/voucher`'s `voucherSchema` — a voucher, once minted,
 * carries its own code/expiry independent of the wallet balance that paid
 * for it), so this does not claim they are forfeited too: the honest
 * statement is that the merchant can still honour the code until it
 * expires, but the account being deleted is how the user would normally
 * view/present that code, so they are told to save it first.
 *
 * Deliberately not a `Dialog` (`@yourtal/ui/dialog`, Radix): this route is
 * meant to stay the lightest in the app (see this ticket's report for the
 * measured number), and an inline two-step disclosure needs no extra
 * dependency to get the same "read the consequences before confirming"
 * result. The checkbox gate here is intentional friction that the consent
 * toggles above must NOT have — deletion is irreversible and high-stakes,
 * consent withdrawal is neither.
 *
 * "Completed" clears this device's local Me records
 * (consent/interests/passkey/referral code — everything this ticket's own
 * local seam owns) and says plainly that no real account-deletion backend
 * exists yet, rather than claiming a success this build cannot deliver.
 */
export function MeDeleteAccountSection({ locale }: MeDeleteAccountSectionProps) {
  const t = getMeTranslator(locale);
  const [step, setStep] = useState<DeleteStep>("idle");
  const [understood, setUnderstood] = useState(false);

  function handleConfirm() {
    clearConsentPreferences();
    clearInterestIds();
    clearPasskeyEnrolled();
    clearReferralCode();
    setStep("completed");
  }

  return (
    <Card className="border-danger/40">
      <CardHeader>
        <CardTitle as="h2">{t("deleteAccount.heading")}</CardTitle>
        {step !== "completed" ? (
          <p className="text-sm font-sans text-fg-muted">{t("deleteAccount.intro")}</p>
        ) : null}
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {step === "idle" ? (
          <Button type="button" variant="destructive" onClick={() => setStep("confirming")}>
            {t("deleteAccount.startCta")}
          </Button>
        ) : null}

        {step === "confirming" ? (
          <div className="flex flex-col gap-3">
            <ul className="list-disc space-y-2 pl-5 text-sm font-sans text-fg">
              <li>{t("deleteAccount.bulletPoints")}</li>
              <li>{t("deleteAccount.bulletVouchers")}</li>
              <li className="font-semibold">{t("deleteAccount.bulletIrreversible")}</li>
            </ul>
            <label className="flex items-start gap-2 text-sm font-sans text-fg">
              <input
                type="checkbox"
                checked={understood}
                onChange={(event) => setUnderstood(event.target.checked)}
                className="mt-0.5 h-5 w-5 shrink-0 rounded border-border-strong text-danger focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              />
              {t("deleteAccount.confirmCheckboxLabel")}
            </label>
            <div className="flex gap-2">
              <Button
                type="button"
                variant="destructive"
                disabled={!understood}
                onClick={handleConfirm}
              >
                {t("deleteAccount.deleteCta")}
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  setStep("idle");
                  setUnderstood(false);
                }}
              >
                {t("deleteAccount.cancelCta")}
              </Button>
            </div>
          </div>
        ) : null}

        {step === "completed" ? (
          <div role="status" className="flex flex-col gap-1">
            <p className="text-sm font-sans font-semibold text-fg">
              {t("deleteAccount.completedHeading")}
            </p>
            <p className="text-sm font-sans text-fg-muted">{t("deleteAccount.completedBody")}</p>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
