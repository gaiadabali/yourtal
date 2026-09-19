"use client";

import { useState } from "react";
import { Badge } from "@yourtal/ui/badge";
import { Button } from "@yourtal/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@yourtal/ui/card";
import { readPasskeyEnrolled, writePasskeyEnrolled } from "./me-security-store";
import { getMeTranslator, type SupportedLocale } from "./me-i18n";

export interface MeSecuritySectionProps {
  locale: SupportedLocale;
}

/**
 * Security — copy is deliberately blunt about what each control does and
 * does not prove (docs/23-critique.md §1.0: passkeys were measured at $0 to
 * fake at scale, phone OTP at cents per account; neither is described here
 * as making an account "secure"). The passkey control is explicitly labelled
 * a prototype: it only flips a `localStorage` label
 * (`me-security-store.ts`) since no WebAuthn/backend exists in this ticket's
 * scope, and the OTP row states plainly that no verified phone number is
 * persisted anywhere for this screen to display — it is not lying by
 * inventing one.
 */
export function MeSecuritySection({ locale }: MeSecuritySectionProps) {
  const t = getMeTranslator(locale);
  const [enrolled, setEnrolled] = useState(() => readPasskeyEnrolled());

  function toggleEnrolled() {
    const next = !enrolled;
    setEnrolled(next);
    writePasskeyEnrolled(next);
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle as="h2">{t("security.heading")}</CardTitle>
        <p className="text-sm font-sans text-fg-muted">{t("security.intro")}</p>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <div className="rounded-lg border border-border bg-surface p-4">
          <p className="text-sm font-sans font-semibold text-fg">{t("security.otpTitle")}</p>
          <p className="mt-1 text-sm font-sans text-fg-muted">{t("security.otpBody")}</p>
        </div>
        <div className="rounded-lg border border-border bg-surface p-4">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-sm font-sans font-semibold text-fg">
                {t("security.passkeyTitle")}
              </p>
              <p className="mt-1 text-sm font-sans text-fg-muted">{t("security.passkeyBody")}</p>
            </div>
            <Badge variant={enrolled ? "success" : "secondary"}>
              {enrolled
                ? t("security.passkeyEnrolledLabel")
                : t("security.passkeyNotEnrolledLabel")}
            </Badge>
          </div>
          <Button
            type="button"
            variant={enrolled ? "outline" : "secondary"}
            size="sm"
            className="mt-3"
            onClick={toggleEnrolled}
          >
            {enrolled ? t("security.removeCta") : t("security.enrollCta")}
          </Button>
          <p className="mt-2 text-xs font-sans text-fg-subtle">{t("security.prototypeNote")}</p>
        </div>
      </CardContent>
    </Card>
  );
}
