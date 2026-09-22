"use client";

import { useEffect, useReducer } from "react";
import { useRouter } from "next/navigation";
import type { Route } from "next";
import type { Region } from "@yourtal/contracts/region";
import { regionDisplayConfig } from "@/features/region/region-config";
import { getOnboardingCopy } from "./onboarding-copy";
import { measureOnboardingDuration, recordOnboardingMark } from "./onboarding-timing";
import { isOtpCodeCorrect, MOCK_NETWORK_DELAY_MS } from "./otp-mock-service";
import { initialPhoneFlowState, phoneFlowReducer } from "./phone-verification-reducer";
import { withReturnTo } from "./onboarding-return-to";
import { useResendCooldown } from "./use-resend-cooldown";
import { PhoneEntryStep } from "./phone-entry-step";
import { CodeEntryStep } from "./code-entry-step";
import { RateLimitedStep } from "./rate-limited-step";

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
