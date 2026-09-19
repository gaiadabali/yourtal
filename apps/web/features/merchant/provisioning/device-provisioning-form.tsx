import { Button } from "@yourtal/ui/button";
import { Input } from "@yourtal/ui/input";
import { submitProvisioningCode } from "./provisioning-actions";
import { PROVISIONING_FORM_TEXT, type ProvisioningFormErrorCode } from "./provisioning-copy";

export interface DeviceProvisioningFormProps {
  // `| undefined` is explicit, not redundant: tsconfig sets
  // `exactOptionalPropertyTypes: true`, and `page.tsx` passes through a
  // `string | undefined` search param value, not just an omitted key.
  error?: string | undefined;
}

function isKnownError(value: string | undefined): value is ProvisioningFormErrorCode {
  return value === "invalid_code" || value === "pin_invalid" || value === "pin_mismatch";
}

/**
 * The screen a brand-new (or freshly un-paired — see `revokeDeviceAction`)
 * browser sees at `/merchant`: `merchant-data.ts`'s `getMerchantDevice()`
 * returned `null`, meaning no device binding cookie exists yet.
 *
 * A Server Component, not a "use client" leaf — same reasoning as
 * `apps/web/features/onboarding/region-picker.tsx`: a plain
 * `<form action={submitProvisioningCode}>` needs zero client JS, which
 * matters here specifically because `/merchant` is already the
 * second-heaviest route in the app (docs/13b-typescript-standards.md
 * section 8's 180 KB justification band) — this screen adds none of that
 * budget.
 *
 * This is HALF of docs/17-surfaces-and-roles.md section 2.2's provisioning
 * story: "An Admin provisions a store device... bound to a location,
 * named." The Admin-facing half — generating the code shown as
 * `PROVISIONING_FORM_TEXT.codeLabel` below, from the business console's
 * Team zone — is explicitly out of this ticket's ownership (another
 * agent's territory; see `provisioning-data.ts`'s comment). What this
 * component owns is the device's side of that pairing: entering the code
 * an Admin already generated, and choosing the shift PIN in the same step
 * so staff never see an unprotected, unlocked counter between pairing and
 * first use.
 */
export function DeviceProvisioningForm({ error }: DeviceProvisioningFormProps) {
  const knownError = isKnownError(error) ? PROVISIONING_FORM_TEXT.errors[error] : null;

  return (
    <div className="mx-auto flex w-full max-w-xl flex-col gap-6 p-4">
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-sans font-semibold text-fg">
          {PROVISIONING_FORM_TEXT.heading.en}
        </h1>
        <p className="text-sm font-sans text-fg-muted">{PROVISIONING_FORM_TEXT.heading.id}</p>
      </header>
      <p className="text-sm font-sans text-fg-muted">{PROVISIONING_FORM_TEXT.intro.en}</p>
      <p className="text-sm font-sans text-fg-muted">{PROVISIONING_FORM_TEXT.intro.id}</p>
      {knownError ? (
        <p
          role="alert"
          className="rounded-lg border border-danger bg-danger/10 p-3 text-sm font-sans text-danger"
        >
          {knownError.en} / {knownError.id}
        </p>
      ) : null}
      <form action={submitProvisioningCode} className="flex flex-col gap-4">
        <Input
          label={`${PROVISIONING_FORM_TEXT.codeLabel.en} / ${PROVISIONING_FORM_TEXT.codeLabel.id}`}
          name="code"
          required
          autoCapitalize="characters"
          autoComplete="off"
          className="h-14 text-xl uppercase tracking-wide"
        />
        <Input
          label={`${PROVISIONING_FORM_TEXT.pinLabel.en} / ${PROVISIONING_FORM_TEXT.pinLabel.id}`}
          helpText={`${PROVISIONING_FORM_TEXT.pinHelp.en} / ${PROVISIONING_FORM_TEXT.pinHelp.id}`}
          name="pin"
          type="password"
          inputMode="numeric"
          pattern="\d{4,6}"
          required
          className="h-14 text-xl tracking-widest"
        />
        <Input
          label={`${PROVISIONING_FORM_TEXT.confirmPinLabel.en} / ${PROVISIONING_FORM_TEXT.confirmPinLabel.id}`}
          name="confirmPin"
          type="password"
          inputMode="numeric"
          pattern="\d{4,6}"
          required
          className="h-14 text-xl tracking-widest"
        />
        <Button type="submit" size="lg" className="h-14 text-base">
          {PROVISIONING_FORM_TEXT.submitButton.en} / {PROVISIONING_FORM_TEXT.submitButton.id}
        </Button>
      </form>
    </div>
  );
}
