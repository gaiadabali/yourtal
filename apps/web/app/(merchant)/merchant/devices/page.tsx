import type { Metadata } from "next";
import { Badge } from "@yourtal/ui/badge";
import { Button } from "@yourtal/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@yourtal/ui/card";
import { getMerchantDevice } from "@/features/merchant/merchant-data";
import { getProvisioningCopy } from "@/features/merchant/provisioning/provisioning-copy";
import { listOtherKnownDevices } from "@/features/merchant/provisioning/provisioning-data";
import { revokeDeviceAction } from "@/features/merchant/provisioning/provisioning-actions";

export const metadata: Metadata = { title: "Devices · YourTal Merchant" };

/**
 * `/merchant/devices` — docs/tasks/phase-u-ui.md YT-0446's third
 * acceptance criterion, "revoke flow visible and immediate."
 *
 * THIS IS A MOCK STAND-IN, not the real control. Per
 * docs/17-surfaces-and-roles.md section 2.2, revocation belongs in the
 * business console's Team zone ("revocable instantly and individually
 * from the Team zone") — a real Admin, on a real office device, revoking
 * one row in a real roster of every device the business has paired. That
 * console is another agent's territory and does not exist yet. What this
 * page demonstrates instead is the DEVICE side of that contract: calling
 * `revokeDeviceAction`, which is exactly the mutation a real Team-zone
 * page would call, against the same in-process mock registry
 * `provisioning-data.ts` documents the limits of.
 *
 * Reachable only by typing the URL — there is deliberately no link to it
 * from the counter screen itself (a staff member should never be one tap
 * away from revoking their own working device; that is an Admin action).
 *
 * A pure Server Component: revoking is a plain `<form action={...}>` per
 * device row, same zero-client-JS pattern as the rest of this feature.
 */
export default async function MerchantDevicesPage() {
  const thisDevice = await getMerchantDevice();
  const otherDevices = await listOtherKnownDevices();
  const copy = getProvisioningCopy(thisDevice?.locale ?? "en-AU");

  return (
    <div className="mx-auto flex w-full max-w-xl flex-col gap-4 p-4">
      <h1 className="text-2xl font-sans font-semibold text-fg">{copy.devicesHeading}</h1>
      <div className="flex flex-col gap-3">
        {thisDevice ? (
          <Card>
            <CardHeader className="flex-row items-center justify-between">
              <CardTitle as="h2">
                {thisDevice.label}{" "}
                <span className="font-normal text-fg-muted">{copy.devicesThisDevice}</span>
              </CardTitle>
            </CardHeader>
            <CardContent className="flex items-center justify-between gap-3">
              <p className="text-sm font-sans text-fg-muted">{thisDevice.merchantName}</p>
              <form action={revokeDeviceAction}>
                <input type="hidden" name="deviceId" value={thisDevice.id} />
                <Button type="submit" variant="destructive" size="sm">
                  {copy.revokeButton}
                </Button>
              </form>
            </CardContent>
          </Card>
        ) : null}
        {otherDevices.map((device) => (
          <Card key={device.deviceId}>
            <CardHeader className="flex-row items-center justify-between">
              <CardTitle as="h2">{device.label}</CardTitle>
              {device.revoked ? <Badge variant="danger">{copy.revokedBadge}</Badge> : null}
            </CardHeader>
            <CardContent className="flex items-center justify-between gap-3">
              <p className="text-sm font-sans text-fg-muted">{device.merchantName}</p>
              {device.revoked ? null : (
                <form action={revokeDeviceAction}>
                  <input type="hidden" name="deviceId" value={device.deviceId} />
                  <Button type="submit" variant="destructive" size="sm">
                    {copy.revokeButton}
                  </Button>
                </form>
              )}
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
