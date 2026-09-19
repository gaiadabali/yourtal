"use client";

import { useState } from "react";
import type { SubmitEvent } from "react";
import { useRouter } from "next/navigation";
import type { Region } from "@yourtal/contracts/region";
import { Button } from "@yourtal/ui/button";
import { regionDisplayConfig } from "@/features/region/region-config";
import { getOnboardingCopy } from "./onboarding-copy";
import { saveOnboardingConsentChoice } from "./onboarding-local-store";

export interface ConsentFormProps {
  region: Region;
}

/**
 * Per-purpose consent (docs/tasks/phase-u-ui.md YT-0430; docs/03-regulatory-and-risk.md
 * section 2.3 and docs/24-legal-positions.md ID-7: "consent must be specific
 * and unambiguous, preceded by concise, accurate information covering
 * ... purpose, data types"). Three independent, un-ticked, plain-language
 * controls — never one blanket "I agree" checkbox. Each purpose's own copy
 * (`onboarding-copy-*.ts`) states exactly what is collected and why, in the
 * user's chosen language.
 *
 * Only the essential purpose is required, via BOTH the native `required`
 * attribute (works even before hydration) and `disabled={!essential}` on
 * the submit button (immediate feedback once JS has loaded) — belt and
 * suspenders, matching `features/checkpoint/checkpoint-question-step.tsx`'s
 * `canProceed` pattern.
 */
export function ConsentForm({ region }: ConsentFormProps) {
  const router = useRouter();
  const copy = getOnboardingCopy(regionDisplayConfig(region).locale).consent;
  const [essential, setEssential] = useState(false);
  const [personalize, setPersonalize] = useState(false);
  const [marketing, setMarketing] = useState(false);

  function handleSubmit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!essential) {
      return;
    }
    saveOnboardingConsentChoice({
      essential: true,
      personalize,
      marketing,
      decidedAt: new Date().toISOString(),
    });
    router.push(`/onboarding/${region}/verify`);
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h2 className="text-xl font-sans font-semibold text-fg">{copy.heading}</h2>
        <p className="text-sm font-sans text-fg-muted">{copy.intro}</p>
      </div>
      <div className="flex flex-col gap-3">
        <ConsentPurpose
          id="onboarding-consent-essential"
          title={copy.essential.title}
          body={copy.essential.body}
          checked={essential}
          onChange={setEssential}
          required
          hint={copy.requiredHint}
        />
        <ConsentPurpose
          id="onboarding-consent-personalize"
          title={copy.personalize.title}
          body={copy.personalize.body}
          checked={personalize}
          onChange={setPersonalize}
        />
        <ConsentPurpose
          id="onboarding-consent-marketing"
          title={copy.marketing.title}
          body={copy.marketing.body}
          checked={marketing}
          onChange={setMarketing}
        />
      </div>
      <Button type="submit" disabled={!essential}>
        {copy.continueLabel}
      </Button>
    </form>
  );
}

interface ConsentPurposeProps {
  id: string;
  title: string;
  body: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  required?: boolean;
  hint?: string;
}

/** One purpose, one control, one plain-language explanation — unticked by default (initial `checked` always comes from a `useState(false)` above). */
function ConsentPurpose({
  id,
  title,
  body,
  checked,
  onChange,
  required,
  hint,
}: ConsentPurposeProps) {
  return (
    <div className="flex gap-3 rounded-lg border border-border bg-surface p-4">
      <input
        type="checkbox"
        id={id}
        checked={checked}
        required={required}
        onChange={(event) => onChange(event.target.checked)}
        className="mt-1 h-5 w-5 shrink-0 rounded border-border-strong text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      />
      <label htmlFor={id} className="flex flex-col gap-1">
        <span className="text-sm font-sans font-semibold text-fg">
          {title}
          {required === true ? (
            <span className="ml-1 text-xs font-normal text-fg-subtle">({hint})</span>
          ) : null}
        </span>
        <span className="text-sm font-sans text-fg-muted">{body}</span>
      </label>
    </div>
  );
}
