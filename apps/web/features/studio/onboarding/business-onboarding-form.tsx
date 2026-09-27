import type { Region } from "@yourtal/contracts/region";
import { Button } from "@yourtal/ui/button";
import { Input } from "@yourtal/ui/input";
import { NativeSelect } from "@yourtal/ui/native-select";
import { Card, CardContent } from "@yourtal/ui/card";
import { getStudioTranslator } from "../studio-i18n";
import { createBusinessAction } from "./create-business-action";
import { AU_STATES } from "./au-states";
import { TAX_ID_KINDS_BY_REGION } from "./business-onboarding-input";

export interface BusinessOnboardingFormProps {
  /** Fixed to the signed-in person's own account region (TASKS.md 7.1.a: "region fixed") — never a choice this form offers. */
  region: Region;
  /** The message key from `?error=`, or `null` when this is a fresh visit. */
  errorField: string | null;
}

/**
 * The business-creation form (task 7.8.b) — a plain `<form
 * action={createBusinessAction}>`, no client JS: `region` is fixed server
 * side, so which tax-id kinds and address fields to show is already known
 * before this renders, with no client-side branching needed.
 */
export function BusinessOnboardingForm({ region, errorField }: BusinessOnboardingFormProps) {
  const t = getStudioTranslator();
  const taxIdKinds = TAX_ID_KINDS_BY_REGION[region];
  const errorMessages: Record<string, string> = {
    create_failed: t("onboarding.error.createFailed"),
    invalid_input: t("onboarding.error.invalidInput"),
  };

  return (
    <Card>
      <CardContent className="flex flex-col gap-4 p-6">
        {errorField ? (
          <p className="text-body-sm text-danger-solid" role="alert">
            {errorMessages[errorField] ?? t("onboarding.error.fieldFallback", { errorField })}
          </p>
        ) : null}
        <form action={createBusinessAction} className="flex flex-col gap-4">
          <input type="hidden" name="region" value={region} />
          <Input name="legalName" label={t("onboarding.legalNameLabel")} required maxLength={160} />
          <Input
            name="displayName"
            label={t("onboarding.displayNameLabel")}
            required
            maxLength={120}
          />
          <Input
            name="handle"
            label={t("onboarding.handleLabel")}
            required
            maxLength={40}
            placeholder={t("onboarding.handlePlaceholder")}
            helpText={t("onboarding.handleHelp")}
          />

          <NativeSelect
            name="taxIdKind"
            label={t("onboarding.taxIdKindLabel")}
            required
            defaultValue={taxIdKinds[0]}
          >
            {taxIdKinds.map((kind) => (
              <option key={kind} value={kind}>
                {kind}
              </option>
            ))}
          </NativeSelect>
          <Input
            name="taxIdValue"
            label={t("onboarding.taxIdValueLabel")}
            required
            inputMode="numeric"
          />

          <Input name="addressLine" label={t("onboarding.addressLabel")} required maxLength={200} />
          <Input name="city" label={t("onboarding.cityLabel")} required maxLength={60} />
          {region === "AU" ? (
            <NativeSelect name="state" label={t("onboarding.stateLabel")} required defaultValue="">
              <option value="" disabled>
                {t("onboarding.selectState")}
              </option>
              {AU_STATES.map((state) => (
                <option key={state.value} value={state.value}>
                  {state.label}
                </option>
              ))}
            </NativeSelect>
          ) : null}
          <Input name="postcode" label={t("onboarding.postcodeLabel")} required maxLength={12} />

          <Button type="submit" className="w-fit">
            {t("onboarding.createBusiness")}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
