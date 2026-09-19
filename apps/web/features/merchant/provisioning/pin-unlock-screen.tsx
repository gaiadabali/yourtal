import { Badge } from "@yourtal/ui/badge";
import { Button } from "@yourtal/ui/button";
import { Input } from "@yourtal/ui/input";
import type { MerchantDevice } from "../merchant-device";
import { getProvisioningCopy } from "./provisioning-copy";
import { unlockWithPin } from "./provisioning-actions";

export interface PinUnlockScreenProps {
  device: MerchantDevice;
  // See `device-provisioning-form.tsx`'s comment on `exactOptionalPropertyTypes`.
  error?: string | undefined;
}

/**
 * Shown whenever this device IS paired but the current shift's PIN unlock
 * is not in effect (`merchant-data.ts` returned a device, but
 * `isDeviceUnlocked()` said no) — the first screen after a fresh page
 * load, after `lockDeviceAction` fires (manual "Lock now", inactivity, or
 * the tab going hidden — see `use-auto-lock.ts`), or the first screen
 * after re-provisioning.
 *
 * The PIN-unlock help text says, in the staff member's own language, what
 * docs/17-surfaces-and-roles.md section 2.2 says in the spec: this is a
 * shift convenience lock, not a personal login. That sentence is load-
 * bearing UI copy, not decoration — it is what stops staff (or whoever
 * trains them) from treating a shared 4-digit PIN as though it were an
 * account password with the security properties that implies.
 *
 * A Server Component with a plain `<form action={unlockWithPin}>` — same
 * zero-client-JS reasoning as `device-provisioning-form.tsx`.
 */
export function PinUnlockScreen({ device, error }: PinUnlockScreenProps) {
  const copy = getProvisioningCopy(device.locale);
  const errorMessage =
    error === "wrong_pin"
      ? copy.errorWrongPin
      : error === "too_many_attempts"
        ? copy.errorTooManyAttempts
        : null;

  return (
    <div className="mx-auto flex w-full max-w-sm flex-col gap-6 p-4 pt-16">
      <header className="flex flex-col items-center gap-2 text-center">
        <Badge variant="secondary">
          {copy.lockedByDeviceLabel}: {device.label}
        </Badge>
        <h1 className="text-2xl font-sans font-semibold text-fg">{copy.unlockHeading}</h1>
        <p className="text-sm font-sans text-fg-muted">{copy.unlockPinHelp}</p>
      </header>
      {errorMessage ? (
        <p
          role="alert"
          className="rounded-lg border border-danger bg-danger/10 p-3 text-center text-sm font-sans text-danger"
        >
          {errorMessage}
        </p>
      ) : null}
      <form action={unlockWithPin} className="flex flex-col gap-4">
        <Input
          label={copy.pinLabel}
          hideLabel
          name="pin"
          type="password"
          inputMode="numeric"
          autoComplete="off"
          autoFocus
          required
          className="h-16 text-center text-3xl tracking-[0.5em]"
        />
        <Button type="submit" size="lg" className="h-14 text-base">
          {copy.unlockButton}
        </Button>
      </form>
    </div>
  );
}
