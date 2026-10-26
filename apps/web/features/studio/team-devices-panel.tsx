"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import type {
  CounterDevice,
  ProvisionDeviceResult,
} from "@yourtal/contracts/device/counter-device";
import type { MerchantLocation } from "@yourtal/contracts/listing/merchant-location";
import { Badge } from "@yourtal/ui/badge";
import { Button } from "@yourtal/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@yourtal/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@yourtal/ui/dialog";
import { provisionDeviceLive, revokeDeviceLive } from "./devices-data";
import { TeamProvisionDeviceDialog } from "./team-provision-device-dialog";

export interface TeamDevicesPanelProps {
  businessId: string;
  initialDevices: readonly CounterDevice[];
  locations: readonly MerchantLocation[];
}

function stateBadgeVariant(state: CounterDevice["state"]): "success" | "warning" | "danger" {
  if (state === "paired") return "success";
  if (state === "revoked") return "danger";
  return "warning";
}

function locationName(locations: readonly MerchantLocation[], locationId: string): string {
  return locations.find((location) => location.id === locationId)?.name ?? locationId;
}

/**
 * TASKS.md 8.1.a: Studio -> Team -> Devices. Provisioning and revoking both
 * move here — `/merchant/devices`'s old unauthenticated revoke is deleted
 * outright (TASKS.md 8.2.a), not merely superseded.
 */
export function TeamDevicesPanel({ businessId, initialDevices, locations }: TeamDevicesPanelProps) {
  const t = useTranslations("studio");
  const [devices, setDevices] = useState<readonly CounterDevice[]>(initialDevices);
  const [provisionOpen, setProvisionOpen] = useState(false);
  const [revokingId, setRevokingId] = useState<string | null>(null);
  /** The device whose revoke is waiting on a confirmation: revoking is immediate and cannot be undone. */
  const [confirming, setConfirming] = useState<CounterDevice | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleProvision(input: {
    locationId: string;
    label: string;
    pin: string;
  }): Promise<{ ok: true; value: ProvisionDeviceResult } | { ok: false; message: string }> {
    const result = await provisionDeviceLive(businessId, input);
    if (!result.ok) {
      return { ok: false, message: result.error.message };
    }
    setDevices((current) => [result.data.device, ...current]);
    return { ok: true, value: result.data };
  }

  async function handleRevoke(deviceId: string) {
    setConfirming(null);
    setRevokingId(deviceId);
    const result = await revokeDeviceLive(businessId, deviceId);
    setRevokingId(null);
    if (!result.ok) {
      setError(result.error.message);
      return;
    }
    setDevices((current) =>
      current.map((device) =>
        device.id === deviceId
          ? { ...device, state: "revoked", revokedAt: new Date().toISOString() }
          : device,
      ),
    );
  }

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between">
        <CardTitle as="h3">{t("devices.panel.title")}</CardTitle>
        <Button type="button" size="sm" onClick={() => setProvisionOpen(true)}>
          {t("devices.panel.provision")}
        </Button>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {error ? (
          <p role="alert" className="text-xs font-sans text-danger">
            {error}
          </p>
        ) : null}
        {devices.length === 0 ? (
          <p className="text-sm font-sans text-fg-muted">{t("devices.panel.empty")}</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {devices.map((device) => (
              <li
                key={device.id}
                className="flex items-center justify-between gap-3 border-b border-border pb-2 text-sm last:border-b-0"
              >
                <div className="flex flex-col">
                  <span className="font-sans text-fg">{device.label}</span>
                  <span className="text-xs text-fg-muted">
                    {locationName(locations, device.locationId)}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <Badge variant={stateBadgeVariant(device.state)}>
                    {t(`devices.state.${device.state}`)}
                  </Badge>
                  {device.state !== "revoked" ? (
                    <Button
                      type="button"
                      variant="destructive"
                      size="sm"
                      disabled={revokingId === device.id}
                      onClick={() => setConfirming(device)}
                    >
                      {t("devices.panel.revoke")}
                    </Button>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
      <Dialog
        open={confirming !== null}
        onOpenChange={(open) => (open ? null : setConfirming(null))}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {t("devices.panel.revokeTitle", { label: confirming?.label ?? "" })}
            </DialogTitle>
            <DialogDescription>{t("devices.panel.revokeBody")}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button type="button" variant="secondary" onClick={() => setConfirming(null)}>
              {t("devices.panel.revokeCancel")}
            </Button>
            <Button
              type="button"
              variant="destructive"
              onClick={() => (confirming ? void handleRevoke(confirming.id) : undefined)}
            >
              {t("devices.panel.revokeConfirm")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <TeamProvisionDeviceDialog
        open={provisionOpen}
        locations={locations}
        onOpenChange={setProvisionOpen}
        onProvision={handleProvision}
      />
    </Card>
  );
}
