"use client";

import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import type { Region } from "@yourtal/contracts/region";
import type { DisplayLocale } from "@yourtal/contracts/identity/user-profile";
import { Input } from "@yourtal/ui/input";
import { NativeSelect } from "@yourtal/ui/native-select";
import { Button } from "@yourtal/ui/button";
import { Notice } from "@yourtal/ui/notice";
import { registerAction } from "./auth-actions";
import { authErrorMessage } from "./auth-error-copy";

export interface RegisterFormProps {
  returnTo: string | null;
  defaultRegion: Region;
  defaultLocale: DisplayLocale;
  /** F4: whether 13-17 registration (with a guardian email) is open right now. */
  teenModeEnabled: boolean;
  errorCode?: string;
}

const TEEN_MIN_YEARS = 13;
const ADULT_MIN_YEARS = 18;

/**
 * Mirrors `packages/jurisdiction/src/age.ts`'s `ageYearsFrom` for this
 * form's OWN field-reveal logic only — restated rather than imported so a
 * client bundle never pulls in a Node-facing package for one date
 * calculation. Getting this wrong only ever shows or hides a field early:
 * `AuthService.register` (1.4.b) recomputes the real age from the same
 * date of birth and is the only thing that actually decides.
 */
function ageYearsFromIso(dateOfBirth: string): number | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateOfBirth)) return null;
  const dob = new Date(dateOfBirth);
  if (Number.isNaN(dob.getTime())) return null;
  const now = new Date();
  let age = now.getUTCFullYear() - dob.getUTCFullYear();
  const hadBirthdayThisYear =
    now.getUTCMonth() > dob.getUTCMonth() ||
    (now.getUTCMonth() === dob.getUTCMonth() && now.getUTCDate() >= dob.getUTCDate());
  if (!hadBirthdayThisYear) age -= 1;
  return age;
}

/**
 * `/register`'s form (6.2.a): email, password, display name, date of
 * birth, region (AU preselected), display language, and a guardian-email
 * field that appears only for a 13-17 date of birth while teen
 * registration is open. A hidden `timezone` field is filled from the
 * browser on mount (falling back to AU's own clock, F16, for a no-JS
 * submission) — `registerAction` sends it straight through to
 * `POST /api/auth/register`.
 */
export function RegisterForm({
  returnTo,
  defaultRegion,
  defaultLocale,
  teenModeEnabled,
  errorCode,
}: RegisterFormProps) {
  const t = useTranslations("auth.register");
  const [dateOfBirth, setDateOfBirth] = useState("");
  const timezoneRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (zone && timezoneRef.current) timezoneRef.current.value = zone;
  }, []);

  const ageYears = ageYearsFromIso(dateOfBirth);
  const isTooYoung = ageYears !== null && ageYears < TEEN_MIN_YEARS;
  const isTeen = ageYears !== null && ageYears >= TEEN_MIN_YEARS && ageYears < ADULT_MIN_YEARS;
  const showGuardianField = isTeen && teenModeEnabled;
  const blockedByAge = isTooYoung || (isTeen && !teenModeEnabled);

  return (
    <form action={registerAction} className="flex flex-col gap-4">
      {/* eslint-disable-next-line yt-b/prefer-primitives */}
      <input ref={timezoneRef} type="hidden" name="timezone" defaultValue="Australia/Sydney" />
      {returnTo ? (
        // eslint-disable-next-line yt-b/prefer-primitives
        <input type="hidden" name="returnTo" value={returnTo} />
      ) : null}

      {errorCode ? <Notice tone="danger">{authErrorMessage(t, errorCode)}</Notice> : null}

      <Input label={t("emailLabel")} name="email" type="email" autoComplete="email" required />
      <Input
        label={t("passwordLabel")}
        name="password"
        type="password"
        autoComplete="new-password"
        minLength={12}
        required
        helpText={t("passwordHelp")}
      />
      <Input
        label={t("displayNameLabel")}
        name="displayName"
        type="text"
        autoComplete="name"
        required
      />
      <Input
        label={t("dateOfBirthLabel")}
        name="dateOfBirth"
        type="date"
        required
        value={dateOfBirth}
        onChange={(event) => setDateOfBirth(event.target.value)}
      />

      {blockedByAge ? (
        <Notice tone="warning">{isTooYoung ? t("tooYoungNotice") : t("belowMinimumAgeNotice")}</Notice>
      ) : null}

      {showGuardianField ? (
        <Input
          label={t("guardianEmailLabel")}
          name="guardianEmail"
          type="email"
          autoComplete="email"
          required
          helpText={t("guardianEmailHelp")}
        />
      ) : null}

      <NativeSelect label={t("regionLabel")} name="region" defaultValue={defaultRegion} required>
        <option value="AU">{t("regionOptionAU")}</option>
        <option value="ID">{t("regionOptionID")}</option>
      </NativeSelect>

      <NativeSelect label={t("languageLabel")} name="locale" defaultValue={defaultLocale} required>
        <option value="en-AU">{t("languageOptionEnAU")}</option>
        <option value="id-ID">{t("languageOptionIdID")}</option>
      </NativeSelect>

      <Button type="submit" disabled={blockedByAge}>
        {t("submitCta")}
      </Button>
    </form>
  );
}
