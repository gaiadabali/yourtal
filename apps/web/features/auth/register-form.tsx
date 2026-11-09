"use client";

import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import Link from "next/link";
import type { Region } from "@yourtal/contracts/region";
import type { DisplayLocale } from "@yourtal/contracts/identity/user-profile";
import { Input } from "@yourtal/ui/input";
import { NativeSelect } from "@yourtal/ui/native-select";
import { Button } from "@yourtal/ui/button";
import { Notice } from "@yourtal/ui/notice";
import { registerAction } from "./auth-actions";
import { authErrorMessage } from "./auth-error-copy";
import type { RegisterDraft } from "./register-draft";

export interface RegisterFormProps {
  returnTo: string | null;
  defaultRegion: Region;
  defaultLocale: DisplayLocale;
  /**
   * F4: whether 13-17 registration (with a guardian email) is open right
   * now. Kept for signature stability with `register/page.tsx` — the real
   * gate is entirely server-side (`AuthService.register`); see this
   * component's own header comment for why the form never branches on it.
   */
  teenModeEnabled: boolean;
  errorCode?: string;
  /** What was typed before a failed submit (never the password). */
  draft?: RegisterDraft;
}

/** Whole years since `dob` (YYYY-MM-DD), or null when it is not a full date. */
function ageOf(dob: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dob);
  if (m === null) return null;
  const now = new Date();
  const before =
    now.getUTCMonth() + 1 < Number(m[2]) ||
    (now.getUTCMonth() + 1 === Number(m[2]) && now.getUTCDate() < Number(m[3]));
  return now.getUTCFullYear() - Number(m[1]) - (before ? 1 : 0);
}

/**
 * These two codes end the attempt outright (12.4.d/#5) — editing the date
 * of birth and resubmitting must never just quietly succeed.
 */
const FINAL_REFUSAL_CODES: ReadonlySet<string> = new Set(["too_young", "below_minimum_age"]);

/**
 * `/register`'s form (6.2.a), hardened by 12.4.d/#5 into a neutral age
 * gate: the date of birth is asked for once and no computed age is shown.
 * The one exception (5.13.x) is the guardian-email field, shown up front for
 * 13-17 while teen sign-up is open (`teenModeEnabled`, staging only). The server
 * alone decides what happens next, from `POST /api/auth/register`'s result
 * (`errorCode`, threaded back through `registerAction`'s `?error=` redirect):
 *
 *  - `guardian_email_required`: re-render with the guardian-email field
 *    added — the same submit resends every other field already typed,
 *    since this is the same mounted `<form>`, not a fresh page;
 *  - `too_young` / `below_minimum_age` (`FINAL_REFUSAL_CODES`): a final,
 *    non-editable refusal for this attempt — the form is replaced
 *    entirely, so changing the date of birth cannot just be resubmitted;
 *  - anything else: the normal inline error banner, form left open.
 */
export function RegisterForm({
  returnTo,
  defaultRegion,
  defaultLocale,
  teenModeEnabled,
  errorCode,
  draft = {},
}: RegisterFormProps) {
  const t = useTranslations("auth.register");
  const [dob, setDob] = useState(draft.dateOfBirth ?? "");
  const timezoneRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (zone && timezoneRef.current) timezoneRef.current.value = zone;
  }, []);

  if (errorCode !== undefined && FINAL_REFUSAL_CODES.has(errorCode)) {
    return (
      <div className="flex flex-col gap-4">
        <Notice tone="warning">{authErrorMessage(t, errorCode)}</Notice>
        <Button asChild variant="secondary">
          <Link href="/register">{t("startOverCta")}</Link>
        </Button>
      </div>
    );
  }

  const age = ageOf(dob);
  // Up front for 13-17 while teen sign-up is open; the server stays the real gate.
  const showGuardianEmail =
    errorCode === "guardian_email_required" ||
    (teenModeEnabled && age !== null && age >= 13 && age < 18);
  const needsGuardianEmail = errorCode === "guardian_email_required";

  return (
    <form action={registerAction} className="flex flex-col gap-4">
      {/* eslint-disable-next-line yt-b/prefer-primitives */}
      <input ref={timezoneRef} type="hidden" name="timezone" defaultValue="Australia/Sydney" />
      {returnTo ? (
        // eslint-disable-next-line yt-b/prefer-primitives
        <input type="hidden" name="returnTo" value={returnTo} />
      ) : null}

      {errorCode !== undefined ? (
        <Notice tone={needsGuardianEmail ? "info" : "danger"}>
          {authErrorMessage(t, errorCode)}
        </Notice>
      ) : null}

      <Input
        label={t("emailLabel")}
        name="email"
        type="email"
        autoComplete="email"
        defaultValue={draft.email}
        required
      />
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
        defaultValue={draft.displayName}
        required
      />
      <Input
        label={t("dateOfBirthLabel")}
        name="dateOfBirth"
        type="date"
        value={dob}
        onChange={(e) => {
          setDob(e.target.value);
        }}
        required
      />

      {showGuardianEmail ? (
        <Input
          label={t("guardianEmailLabel")}
          name="guardianEmail"
          type="email"
          autoComplete="email"
          defaultValue={draft.guardianEmail}
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

      <Button type="submit">{needsGuardianEmail ? t("continueCta") : t("submitCta")}</Button>
    </form>
  );
}
