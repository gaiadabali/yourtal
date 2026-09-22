"use client";

/**
 * Extracted from `phone-verification-flow.tsx` (YT-0525), which sat at 301
 * lines against a 300-line ceiling. One line over is still over, and the
 * flow file was the obvious place to split: it already declared its three
 * steps as separate components, so this moves them rather than redesigning
 * anything.
 */

import { Button } from "@yourtal/ui/button";
import { Input } from "@yourtal/ui/input";
import type { OnboardingCopy } from "./onboarding-copy";
import type { ResendCooldownState } from "./use-resend-cooldown";

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

export function CodeEntryStep({
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
