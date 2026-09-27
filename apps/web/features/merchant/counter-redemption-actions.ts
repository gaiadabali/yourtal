"use server";

import {
  counterAuthorizationSchema,
  counterCaptureSchema,
  counterLogResultSchema,
  counterVoucherPreviewSchema,
  type CounterAuthorization,
  type CounterCapture,
  type CounterLogEntry,
  type CounterVoucherPreview,
} from "@yourtal/contracts/device/counter-redemption";
import type { Currency } from "@yourtal/contracts/money/currency";
import { apiFetch, type ApiResult } from "@/lib/api/api-fetch";
import { readDeviceBinding } from "./provisioning/device-session-cookie";

/**
 * TASKS.md 8.2.a/b/f: the counter's data-access seam for lookup, authorize,
 * capture and today's log — real round trips to A's counter BFF
 * (`apps/api/src/modules/devices/counter/counter.controller.ts`,
 * `POST /api/counter/{lookup,authorize,capture}`, `GET /api/counter/log`),
 * merged on `main` (774157de). No mock branch: same "drop the mock once
 * live exists" convention `wallet-data.ts`/`studio-data.ts` already follow.
 *
 * `"use server"`: every export here is an async Server Action, callable
 * imperatively from `merchant-redemption-screen.tsx` (a "use client" leaf)
 * across the server/client boundary — the same exception
 * `provisioning-actions.ts`'s `lockDeviceAction` already documents. D16
 * (8.2.f) holds here because there is no catalogue at all, mock or
 * otherwise: `counterLookupAction` asks the server for exactly one voucher
 * per submitted code. Every call attaches the device's own bearer
 * credential from the `yt_device` cookie — a hand-made or unsigned cookie
 * fails `readDeviceBinding()`'s schema check before any of this even runs
 * (`device-session-cookie.ts`).
 */

export interface CounterAuthorizeParams {
  code: string;
  amountMinor: number;
  currency: Currency;
  orderRef: string;
  orderTotalMinor: number;
  /** Generated ONCE by the caller and reused on every retry of the same attempt — never regenerated here (see `withDeviceAuth`'s doc comment on why the header can't just mint a fresh one per call). */
  idempotencyKey: string;
}

export interface CounterCaptureParams {
  authorizationId: string;
  idempotencyKey: string;
}

/**
 * Every device-authenticated call goes through here so the `Authorization`
 * header (built from the `yt_device` cookie's credential — never a
 * person's session) is attached exactly once, in exactly one place. An
 * unpaired browser gets the SAME `invalid_device_credential` code the real
 * API returns for an unknown/revoked credential, so callers do not need a
 * separate "not paired" branch.
 */
async function withDeviceAuth<T>(
  call: (authorization: string) => Promise<ApiResult<T>>,
): Promise<ApiResult<T>> {
  const binding = await readDeviceBinding();
  if (!binding) {
    return {
      ok: false,
      error: {
        kind: "http",
        status: 401,
        code: "invalid_device_credential",
        message: "not paired",
      },
    };
  }
  return call(`Bearer ${binding.credential}`);
}

export async function counterLookupAction(code: string): Promise<ApiResult<CounterVoucherPreview>> {
  return withDeviceAuth((authorization) =>
    apiFetch("/api/counter/lookup", counterVoucherPreviewSchema, {
      method: "POST",
      headers: { authorization },
      body: { code },
    }),
  );
}

export async function counterAuthorizeAction(
  params: CounterAuthorizeParams,
): Promise<ApiResult<CounterAuthorization>> {
  const { idempotencyKey, ...body } = params;
  return withDeviceAuth((authorization) =>
    apiFetch("/api/counter/authorize", counterAuthorizationSchema, {
      method: "POST",
      headers: { authorization, "idempotency-key": idempotencyKey },
      body,
    }),
  );
}

export async function counterCaptureAction(
  params: CounterCaptureParams,
): Promise<ApiResult<CounterCapture>> {
  const { authorizationId, idempotencyKey } = params;
  return withDeviceAuth((authorization) =>
    apiFetch("/api/counter/capture", counterCaptureSchema, {
      method: "POST",
      headers: { authorization, "idempotency-key": idempotencyKey },
      body: { authorizationId },
    }),
  );
}

export async function counterLogAction(): Promise<ApiResult<{ entries: CounterLogEntry[] }>> {
  return withDeviceAuth((authorization) =>
    apiFetch("/api/counter/log", counterLogResultSchema, { headers: { authorization } }),
  );
}
