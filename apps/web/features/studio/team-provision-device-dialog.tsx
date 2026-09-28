"use client";

import { useState } from "react";
import type { SubmitEvent } from "react";
import { useTranslations } from "next-intl";
import type { MerchantLocation } from "@yourtal/contracts/listing/merchant-location";
import type { ProvisionDeviceResult } from "@yourtal/contracts/device/counter-device";
import { Button } from "@yourtal/ui/button";
import { Input } from "@yourtal/ui/input";
import { NativeSelect } from "@yourtal/ui/native-select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@yourtal/ui/dialog";

export interface TeamProvisionDeviceDialogProps {
  open: boolean;
  locations: readonly MerchantLocation[];
  onOpenChange: (open: boolean) => void;
  onProvision: (input: {
    locationId: string;
    label: string;
    pin: string;
  }) => Promise<{ ok: true; value: ProvisionDeviceResult } | { ok: false; message: string }>;
}

const PIN_PATTERN = /^\d{4,8}$/u;

/**
 * Provisions a counter device (TASKS.md 8.1.a): label, location, and a PIN
 * the Admin sets on the device's behalf (`device-pairing-form.tsx`'s own
 * doc comment — whoever physically pairs the device no longer chooses it).
 * The one-time pairing code is shown exactly once, on success, in the same
 * dialog — there is no later screen that can show it again
 * (`provisionDeviceResultSchema`'s own doc comment).
 */
export function TeamProvisionDeviceDialog({
  open,
  locations,
  onOpenChange,
  onProvision,
}: TeamProvisionDeviceDialogProps) {
  const t = useTranslations("studio");
  const [label, setLabel] = useState("");
  const [locationId, setLocationId] = useState(locations[0]?.id ?? "");
  const [pin, setPin] = useState("");
  const [confirmPin, setConfirmPin] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ProvisionDeviceResult | null>(null);
  const [submitting, setSubmitting] = useState(false);

  function reset() {
    setLabel("");
    setLocationId(locations[0]?.id ?? "");
    setPin("");
    setConfirmPin("");
    setError(null);
    setResult(null);
    setSubmitting(false);
  }

  async function handleSubmit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!PIN_PATTERN.test(pin)) {
      setError(t("devices.provision.errorPinInvalid"));
      return;
    }
    if (pin !== confirmPin) {
      setError(t("devices.provision.errorPinMismatch"));
      return;
    }
    if (!locationId) {
      setError(t("devices.provision.errorNoLocation"));
      return;
    }
    setSubmitting(true);
    const outcome = await onProvision({ locationId, label, pin });
    setSubmitting(false);
    if (!outcome.ok) {
      setError(outcome.message);
      return;
    }
    setError(null);
    setResult(outcome.value);
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) reset();
        onOpenChange(next);
      }}
    >
      <DialogContent>
        {result ? (
          <>
            <DialogHeader>
              <DialogTitle>{t("devices.provision.doneTitle")}</DialogTitle>
              <DialogDescription>{t("devices.provision.doneDescription")}</DialogDescription>
            </DialogHeader>
            <p className="rounded-lg border border-border bg-surface-sunken p-4 text-center font-mono text-2xl tracking-widest text-fg">
              {result.pairingCode}
            </p>
            <p className="text-xs font-sans text-fg-subtle">
              {t("devices.provision.expires", {
                date: new Date(result.pairingExpiresAt).toLocaleString(),
              })}
            </p>
            <DialogFooter>
              <Button type="button" onClick={() => onOpenChange(false)}>
                {t("devices.provision.done")}
              </Button>
            </DialogFooter>
          </>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle>{t("devices.provision.title")}</DialogTitle>
              <DialogDescription>{t("devices.provision.description")}</DialogDescription>
            </DialogHeader>
            <form onSubmit={(event) => void handleSubmit(event)} className="flex flex-col gap-4">
              <Input
                label={t("devices.provision.labelField")}
                value={label}
                onChange={(event) => setLabel(event.target.value)}
                placeholder={t("devices.provision.labelPlaceholder")}
                required
              />
              <NativeSelect
                label={t("devices.provision.locationField")}
                value={locationId}
                onChange={(event) => setLocationId(event.target.value)}
              >
                {locations.map((location) => (
                  <option key={location.id} value={location.id}>
                    {location.name}
                  </option>
                ))}
              </NativeSelect>
              <Input
                label={t("devices.provision.pinField")}
                type="password"
                inputMode="numeric"
                pattern="\d{4,8}"
                value={pin}
                onChange={(event) => setPin(event.target.value)}
                required
              />
              <Input
                label={t("devices.provision.confirmPinField")}
                type="password"
                inputMode="numeric"
                pattern="\d{4,8}"
                value={confirmPin}
                onChange={(event) => setConfirmPin(event.target.value)}
                required
              />
              {error ? (
                <p role="alert" className="text-xs font-sans text-danger">
                  {error}
                </p>
              ) : null}
              <DialogFooter>
                <Button type="button" variant="secondary" onClick={() => onOpenChange(false)}>
                  {t("team.cancel")}
                </Button>
                <Button type="submit" disabled={submitting}>
                  {submitting ? t("devices.provision.submitting") : t("devices.provision.submit")}
                </Button>
              </DialogFooter>
            </form>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
