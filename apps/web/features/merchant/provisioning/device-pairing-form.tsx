import { Button } from "@yourtal/ui/button";
import { Input } from "@yourtal/ui/input";
import { submitPairingCode } from "./provisioning-actions";
import { getProvisioningFormCopy, type ProvisioningFormErrorCode } from "./provisioning-i18n";

export interface DevicePairingFormProps {
  // `| undefined` is explicit, not redundant: tsconfig sets
  // `exactOptionalPropertyTypes: true`, and `page.tsx` passes through a
  // `string | undefined` search param value, not just an omitted key.
  error?: string | undefined;
}

function isKnownError(value: string | undefined): value is ProvisioningFormErrorCode {
  return value === "invalid_code" || value === "revoked";
}

// One language, the project default — see `provisioning-i18n.ts`'s doc
// comment: no device (and therefore no device locale) exists yet here.
const FORM_TEXT = getProvisioningFormCopy("en-AU");

/**
 * `/merchant/pair` — the screen a brand-new (or freshly revoked) browser
 * lands on. `apps/web/proxy.ts` redirects every other `/merchant/*` route
 * here whenever the `yt_device` cookie is absent.
 *
 * TASKS.md 8.1/8.2 REWRITE: this used to also collect a shift PIN (chosen
 * by whoever was pairing the device). The PIN is now set by the Admin who
 * provisions the device in Studio (`ProvisionDeviceRequest.pin`,
 * `POST /api/:tenantId/studio/devices`) — this form only ever asks for the
 * one-time pairing code, which `submitPairingCode` exchanges for a real
 * bearer credential (`POST /api/devices/pair`).
 *
 * A Server Component with a plain `<form action={submitPairingCode}>` —
 * this screen adds no client JS to `/merchant`'s bundle budget
 * (docs/13b-typescript-standards.md §8).
 */
export function DevicePairingForm({ error }: DevicePairingFormProps) {
  const knownError = isKnownError(error) ? FORM_TEXT.errors[error] : null;

  return (
    <div className="mx-auto flex w-full max-w-xl flex-col gap-6 p-4">
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-sans font-semibold text-fg">{FORM_TEXT.heading}</h1>
      </header>
      <p className="text-sm font-sans text-fg-muted">{FORM_TEXT.intro}</p>
      {knownError ? (
        <p
          role="alert"
          className="rounded-lg border border-danger bg-danger/10 p-3 text-sm font-sans text-danger"
        >
          {knownError}
        </p>
      ) : null}
      <form action={submitPairingCode} className="flex flex-col gap-4">
        <Input
          label={FORM_TEXT.codeLabel}
          name="pairingCode"
          required
          autoCapitalize="characters"
          autoComplete="off"
          className="h-14 text-xl uppercase tracking-wide"
        />
        <Button type="submit" size="lg" className="h-14 text-base">
          {FORM_TEXT.submitButton}
        </Button>
      </form>
    </div>
  );
}
