"use client";

import { useRouter } from "next/navigation";
import type { Route } from "next";
import { useForm } from "react-hook-form";
import type { UseFormRegisterReturn } from "react-hook-form";
import type { Region } from "@yourtal/contracts/region";
import { Button } from "@yourtal/ui/button";
import { regionDisplayConfig } from "@/features/region/region-config";
import { getOnboardingCopy } from "./onboarding-copy";
import { saveOnboardingConsentChoice } from "./onboarding-local-store";
import { withReturnTo } from "./onboarding-return-to";

export interface ConsentFormProps {
  region: Region;
  returnTo: string | null;
}

interface ConsentFormValues {
  essential: boolean;
  personalize: boolean;
  marketing: boolean;
}

const DEFAULT_VALUES: ConsentFormValues = {
  essential: false,
  personalize: false,
  marketing: false,
};

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
 *
 * Migrated to React Hook Form (YT-0525): three real, named boolean fields.
 * `watch("essential")` replaces the old `useState` mirror so the submit
 * button's `disabled` state stays reactive without a controlled `checked`
 * prop on each checkbox — RHF's `register` is uncontrolled (ref-based), and
 * that is enough here since nothing else needs to read a purpose's value
 * outside submit. No Zod schema is added: the only rule this form ever
 * enforced is "essential is required," which `register`'s own `required`
 * option states directly.
 */
export function ConsentForm({ region, returnTo }: ConsentFormProps) {
  const router = useRouter();
  const copy = getOnboardingCopy(regionDisplayConfig(region).locale).consent;
  const { register, handleSubmit, watch } = useForm<ConsentFormValues>({
    defaultValues: DEFAULT_VALUES,
  });
  const essential = watch("essential");

  function onSubmit(values: ConsentFormValues) {
    if (!values.essential) {
      return;
    }
    saveOnboardingConsentChoice({
      essential: true,
      personalize: values.personalize,
      marketing: values.marketing,
      decidedAt: new Date().toISOString(),
    });
    // typedRoutes cast — see commit-region-action.ts for why `withReturnTo`'s
    // plain-`string` return needs one.
    router.push(withReturnTo(`/onboarding/${region}/verify`, returnTo) as Route);
  }

  return (
    <form onSubmit={(event) => void handleSubmit(onSubmit)(event)} className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h2 className="text-xl font-sans font-semibold text-fg">{copy.heading}</h2>
        <p className="text-sm font-sans text-fg-muted">{copy.intro}</p>
      </div>
      <div className="flex flex-col gap-3">
        <ConsentPurpose
          id="onboarding-consent-essential"
          title={copy.essential.title}
          body={copy.essential.body}
          registration={register("essential", { required: true })}
          required
          hint={copy.requiredHint}
        />
        <ConsentPurpose
          id="onboarding-consent-personalize"
          title={copy.personalize.title}
          body={copy.personalize.body}
          registration={register("personalize")}
        />
        <ConsentPurpose
          id="onboarding-consent-marketing"
          title={copy.marketing.title}
          body={copy.marketing.body}
          registration={register("marketing")}
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
  registration: UseFormRegisterReturn;
  required?: boolean;
  hint?: string;
}

/** One purpose, one control, one plain-language explanation — unticked by default (`DEFAULT_VALUES` above). */
function ConsentPurpose({ id, title, body, registration, required, hint }: ConsentPurposeProps) {
  return (
    <div className="flex gap-3 rounded-lg border border-border bg-surface p-4">
      <input
        type="checkbox"
        id={id}
        required={required}
        className="mt-1 h-5 w-5 shrink-0 rounded border-border-strong text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        {...registration}
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
