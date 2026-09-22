"use client";

/**
 * Extracted from `phone-verification-flow.tsx` (YT-0525), which sat at 301
 * lines against a 300-line ceiling. One line over is still over, and the
 * flow file was the obvious place to split: it already declared its three
 * steps as separate components, so this moves them rather than redesigning
 * anything.
 */

import type { Region } from "@yourtal/contracts/region";
import { Button } from "@yourtal/ui/button";
import { Input } from "@yourtal/ui/input";
import { callingCodeForRegion } from "./calling-code";
import type { OnboardingCopy } from "./onboarding-copy";

interface PhoneEntryStepProps {
  copy: OnboardingCopy["verify"];
  region: Region;
  phone: string;
  disabled: boolean;
  onPhoneChange: (phone: string) => void;
  onSubmit: () => void;
}

export function PhoneEntryStep({
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
