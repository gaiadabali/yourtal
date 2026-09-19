"use client";

import { useEffect, useReducer } from "react";
import { useRouter } from "next/navigation";
import type { Route } from "next";
import type { Region } from "@yourtal/contracts/region";
import { Button } from "@yourtal/ui/button";
import { Input } from "@yourtal/ui/input";
import { regionDisplayConfig } from "@/features/region/region-config";
import { callingCodeForRegion } from "./calling-code";
import type { OnboardingCopy, OnboardingLocale } from "./onboarding-copy";
import { getOnboardingCopy } from "./onboarding-copy";
import { measureOnboardingDuration, recordOnboardingMark } from "./onboarding-timing";
import { isOtpCodeCorrect, MOCK_NETWORK_DELAY_MS } from "./otp-mock-service";
import { initialPhoneFlowState, phoneFlowReducer } from "./phone-verification-reducer";
import { withReturnTo } from "./onboarding-return-to";
import type { ResendCooldownState } from "./use-resend-cooldown";
import { useResendCooldown } from "./use-resend-cooldown";

export interface PhoneVerificationFlowProps {
  region: Region;
  returnTo: string | null;
}

/** How long the "Number confirmed" state stays visible before advancing — long enough to read, short enough not to cost the 60s signup budget. */
const VERIFIED_PAUSE_MS = 600;

/**
 * Phone entry, OTP verification, resend, wrong-number and rate-limited
 * states, all in one client leaf (docs/13b-typescript-standards.md section
 * 8: the smallest interactive subtree). State transitions live in
 * `phone-verification-reducer.ts`; this component owns only the mock
 * "network" timers and rendering. Matches `features/burn/burn-flow.tsx`'s
 * shape: one `switch` over a single discriminant, exhaustive with `never`.
 */
export function PhoneVerificationFlow({ region, returnTo }: PhoneVerificationFlowProps) {
  const router = useRouter();
  const { locale } = regionDisplayConfig(region);
  const copy = getOnboardingCopy(locale).verify;
  const [state, dispatch] = useReducer(phoneFlowReducer, initialPhoneFlowState);
  const resendCooldown = useResendCooldown(state.phase === "code" ? state.resendAvailableAt : null);

  useEffect(() => {
    if (state.phase === "sending") {
      const timeoutId = window.setTimeout(
        () => dispatch({ type: "send_delivered", now: Date.now() }),
        MOCK_NETWORK_DELAY_MS,
      );
      return () => window.clearTimeout(timeoutId);
    }
    if (state.phase === "verifying") {
      const correct = isOtpCodeCorrect(state.code);
      const timeoutId = window.setTimeout(
        () => dispatch({ type: "verify_resolved", correct }),
        MOCK_NETWORK_DELAY_MS,
      );
      return () => window.clearTimeout(timeoutId);
    }
    return undefined;
  }, [state.phase, state.code]);

  useEffect(() => {
    if (state.phase !== "verified") {
      return undefined;
    }
    recordOnboardingMark("signup-complete");
    measureOnboardingDuration("yourtal:signup", "signup-start", "signup-complete");
    const timeoutId = window.setTimeout(
      // typedRoutes cast — see commit-region-action.ts.
      () => router.push(withReturnTo(`/onboarding/${region}/interests`, returnTo) as Route),
      VERIFIED_PAUSE_MS,
    );
    return () => window.clearTimeout(timeoutId);
  }, [state.phase, region, returnTo, router]);

  switch (state.phase) {
    case "phone":
    case "sending":
      return (
        <PhoneEntryStep
          copy={copy}
          region={region}
          phone={state.phone}
          disabled={state.phase === "sending"}
          onPhoneChange={(phone) => dispatch({ type: "phone_changed", phone })}
          onSubmit={() => dispatch({ type: "send_requested", now: Date.now() })}
        />
      );
    case "code":
      return (
        <CodeEntryStep
          copy={copy}
          phone={state.phone}
          code={state.code}
          codeError={state.codeError}
          resendCooldown={resendCooldown}
          onCodeChange={(code) => dispatch({ type: "code_changed", code })}
          onVerify={() => dispatch({ type: "verify_requested", now: Date.now() })}
          onResend={() => dispatch({ type: "send_requested", now: Date.now() })}
          onEditNumber={() => dispatch({ type: "edit_number_requested" })}
        />
      );
    case "verifying":
      return (
        <div
          role="status"
          aria-live="polite"
          className="rounded-lg border border-border bg-surface p-6 text-center text-sm font-sans text-fg-muted"
        >
          {copy.verifying}
        </div>
      );
    case "rate_limited":
      return (
        <RateLimitedStep
          copy={copy}
          locale={locale}
          retryAt={state.retryAt}
          onEditNumber={() => dispatch({ type: "edit_number_requested" })}
        />
      );
    case "verified":
      return (
        <div
          role="status"
          aria-live="polite"
          className="flex flex-col items-center gap-2 rounded-lg border border-success bg-success/10 p-6 text-center"
        >
          <p className="text-sm font-sans font-semibold text-success">{copy.verified}</p>
        </div>
      );
    default: {
      const exhaustive: never = state.phase;
      return exhaustive;
    }
  }
}

interface PhoneEntryStepProps {
  copy: OnboardingCopy["verify"];
  region: Region;
  phone: string;
  disabled: boolean;
  onPhoneChange: (phone: string) => void;
  onSubmit: () => void;
}

function PhoneEntryStep({
  copy,
  region,
  phone,
  disabled,
  onPhoneChange,
  onSubmit,
}: PhoneEntryStepProps) {
  const callingCode = callingCodeForRegion(region);
  const canSubmit = !disabled && phone.replace(/\D/g, "").length >= 8;

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        if (canSubmit) {
          onSubmit();
        }
      }}
      className="flex flex-col gap-4"
    >
      <div className="flex flex-col gap-1">
        <h2 className="text-xl font-sans font-semibold text-fg">{copy.phoneHeading}</h2>
        <p className="text-sm font-sans text-fg-muted">{copy.phoneIntro}</p>
      </div>
      <Input
        type="tel"
        inputMode="tel"
        autoComplete="tel"
        label={copy.phoneLabel}
        helpText={copy.phoneHelp}
        value={phone}
        disabled={disabled}
        onChange={(event) => onPhoneChange(event.target.value)}
        placeholder={`${callingCode} 4XX XXX XXX`}
      />
      <Button type="submit" disabled={!canSubmit}>
        {disabled ? copy.sending : copy.sendCode}
      </Button>
    </form>
  );
}

interface CodeEntryStepProps {
  copy: OnboardingCopy["verify"];
  phone: string;
  code: string;
  codeError: boolean;
  resendCooldown: ResendCooldownState;
  onCodeChange: (code: string) => void;
  onVerify: () => void;
  onResend: () => void;
  onEditNumber: () => void;
}

function CodeEntryStep({
  copy,
  phone,
  code,
  codeError,
  resendCooldown,
  onCodeChange,
  onVerify,
  onResend,
  onEditNumber,
}: CodeEntryStepProps) {
  const canVerify = code.trim().length === 6;

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        if (canVerify) {
          onVerify();
        }
      }}
      className="flex flex-col gap-4"
    >
      <div className="flex flex-col gap-1">
        <h2 className="text-xl font-sans font-semibold text-fg">{copy.codeHeading}</h2>
        <p className="text-sm font-sans text-fg-muted">
          {copy.codeSentPrefix} <span className="font-medium text-fg">{phone}</span>
        </p>
      </div>
      <Input
        type="text"
        inputMode="numeric"
        autoComplete="one-time-code"
        maxLength={6}
        label={copy.codeLabel}
        value={code}
        onChange={(event) => onCodeChange(event.target.value.replace(/\D/g, ""))}
        errorMessage={codeError ? copy.wrongCode : ""}
      />
      <Button type="submit" disabled={!canVerify}>
        {copy.verifyCta}
      </Button>
      <div className="flex items-center justify-between gap-3 text-sm font-sans">
        <button
          type="button"
          onClick={onResend}
          disabled={!resendCooldown.canResend}
          className="text-primary underline decoration-dotted underline-offset-2 disabled:cursor-not-allowed disabled:text-fg-subtle disabled:no-underline"
        >
          {resendCooldown.canResend
            ? copy.resend
            : `${copy.resendCooldownPrefix} ${resendCooldown.secondsRemaining}${copy.resendCooldownSuffix}`}
        </button>
        <button
          type="button"
          onClick={onEditNumber}
          className="text-fg-muted underline decoration-dotted underline-offset-2"
        >
          {copy.wrongNumber}
        </button>
      </div>
      <p className="text-xs font-sans text-fg-subtle">{copy.demoCodeHint}</p>
      <p className="text-xs font-sans text-fg-subtle">{copy.otpDisclaimer}</p>
    </form>
  );
}

interface RateLimitedStepProps {
  copy: OnboardingCopy["verify"];
  locale: OnboardingLocale;
  retryAt: number | null;
  onEditNumber: () => void;
}

function RateLimitedStep({ copy, locale, retryAt, onEditNumber }: RateLimitedStepProps) {
  const retryLabel =
    retryAt !== null
      ? new Date(retryAt).toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit" })
      : null;

  return (
    <div
      role="alert"
      className="flex flex-col gap-3 rounded-lg border border-warning bg-warning/10 p-4"
    >
      <p className="text-sm font-sans font-semibold text-warning">{copy.rateLimitedHeading}</p>
      <p className="text-sm font-sans text-fg">{copy.rateLimitedBody}</p>
      {retryLabel !== null ? (
        <p className="text-sm font-sans text-fg">
          {copy.rateLimitedRetryPrefix}{" "}
          <span className="font-semibold tabular-nums">{retryLabel}</span>.
        </p>
      ) : null}
      <Button type="button" variant="secondary" onClick={onEditNumber}>
        {copy.wrongNumber}
      </Button>
    </div>
  );
}
