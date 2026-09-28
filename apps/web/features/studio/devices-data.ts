"use server";

import {
  counterDeviceSchema,
  provisionDeviceResultSchema,
  type CounterDevice,
  type ProvisionDeviceResult,
} from "@yourtal/contracts/device/counter-device";
import { z } from "zod";
import { apiFetch, type ApiResult } from "@/lib/api/api-fetch";

/**
 * TASKS.md 8.1.a: Studio -> Team -> Devices, against A's merged
 * `apps/api/src/modules/devices/studio-devices.controller.ts`
 * (`GET/POST /api/:tenantId/studio/devices`,
 * `DELETE /api/:tenantId/studio/devices/:deviceId`). Live only, same
 * "no mock branch once the real endpoint exists" convention as
 * `team-live-actions.ts`.
 */

const listResponseSchema = z.array(counterDeviceSchema);

export async function listDevicesLive(businessId: string): Promise<ApiResult<CounterDevice[]>> {
  return apiFetch(`/api/${businessId}/studio/devices`, listResponseSchema);
}

export interface ProvisionDeviceInput {
  locationId: string;
  label: string;
  pin: string;
}

export async function provisionDeviceLive(
  businessId: string,
  input: ProvisionDeviceInput,
): Promise<ApiResult<ProvisionDeviceResult>> {
  return apiFetch(`/api/${businessId}/studio/devices`, provisionDeviceResultSchema, {
    method: "POST",
    headers: { "idempotency-key": crypto.randomUUID() },
    body: input,
  });
}

const revokeResponseSchema = z.object({ revoked: z.literal(true) });

export async function revokeDeviceLive(
  businessId: string,
  deviceId: string,
): Promise<ApiResult<{ revoked: true }>> {
  return apiFetch(`/api/${businessId}/studio/devices/${deviceId}`, revokeResponseSchema, {
    method: "DELETE",
  });
}
