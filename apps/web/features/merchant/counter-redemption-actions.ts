"use server";

import { resolveDataSource } from "@yourtal/contracts/mock-source";
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
import { toMinorUnits } from "@yourtal/contracts/money";
import { apiFetch, type ApiResult } from "@/lib/api/api-fetch";
import { readDeviceBinding } from "./provisioning/device-session-cookie";

/**
 * TASKS.md 8.2.a/b/f: the counter's ONE data-access seam for lookup,
 * authorize, capture and today's log — same "one switch flips every
 * screen between mock and live" rule as every other feature
 * (`merchant-data.ts`'s history, `wallet-data.ts`, `studio-data.ts`). The
 * `live` branch is not wired in yet: A's counter BFF routes (`POST
 * /api/counter/{lookup,authorize,capture}`, `GET /api/counter/log`,
 * TASKS.md 8.2.b) are still on `phase/8`, unmerged — poll slot 8's Now row
 * for the SHA, then fill in `live` below without touching any caller.
 *
 * `"use server"`: every export here is an async Server Action, callable
 * imperatively from `merchant-redemption-screen.tsx` (a "use client" leaf)
 * across the server/client boundary — the same exception
 * `provisioning-actions.ts`'s `lockDeviceAction` already documents. This is
 * also the file that makes D16 (8.2.f) hold for the REAL implementation
 * later: nothing here ships a voucher catalogue to the client bundle (the
 * mock fixtures below never leave this module), and every call attaches
 * the device's own bearer credential from the `yt_device` cookie — a
 * hand-made or unsigned cookie fails `readDeviceBinding()`'s schema check
 * before any of this even runs (`device-session-cookie.ts`).
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

interface CounterDataSource {
  lookup: (code: string) => Promise<ApiResult<CounterVoucherPreview>>;
  authorize: (params: CounterAuthorizeParams) => Promise<ApiResult<CounterAuthorization>>;
  capture: (params: CounterCaptureParams) => Promise<ApiResult<CounterCapture>>;
  log: () => Promise<ApiResult<{ entries: CounterLogEntry[] }>>;
}

// ---------------------------------------------------------------------------
// Mock fixtures — server-only (this whole file is "use server"), so none of
// this reaches the client bundle. A small, fixed set of codes covering every
// error branch the UI needs to demonstrate, not a full merchant catalogue.
// ---------------------------------------------------------------------------

const MOCK_HELD: Map<
  string,
  {
    preview: CounterVoucherPreview;
    amountMinor: CounterVoucherPreview["remainingValueMinor"];
    orderRef: string;
  }
> = new Map();
const MOCK_LOG: CounterLogEntry[] = [];

/** `null` for any code with no fixture — including `REDEEMED1`/`EXPIRED01`, whose OWN error is special-cased directly in `mockDataSource.lookup` rather than modelled here. */
function mockPreviewFor(code: string): CounterVoucherPreview | null {
  const normalized = code.trim().toUpperCase();
  switch (normalized) {
    case "HEALTHY1":
      return {
        voucherId: "00000000-0000-4000-8000-000000000101",
        merchantName: "Kopi Kenangan Kemang",
        offerTitle: "20% off any drink",
        remainingValueMinor: toMinorUnits(5000),
        currency: "AUD",
        partialRedemptionPolicy: "balance_carrying",
      };
    case "SINGLEUSE":
      return {
        voucherId: "00000000-0000-4000-8000-000000000102",
        merchantName: "Toko Berkah",
        offerTitle: "Free tote bag",
        remainingValueMinor: toMinorUnits(25000),
        currency: "IDR",
        partialRedemptionPolicy: "single_use",
      };
    default:
      return null;
  }
}

const mockDataSource: CounterDataSource = {
  lookup: (code) => {
    const normalized = code.trim().toUpperCase();
    if (normalized === "REDEEMED1") {
      return Promise.resolve({
        ok: false,
        error: { kind: "http", status: 409, code: "already_redeemed", message: "already redeemed" },
      });
    }
    if (normalized === "EXPIRED01") {
      return Promise.resolve({
        ok: false,
        error: { kind: "http", status: 409, code: "expired", message: "this voucher has expired" },
      });
    }
    const preview = mockPreviewFor(normalized);
    if (!preview) {
      return Promise.resolve({
        ok: false,
        error: { kind: "http", status: 404, code: "voucher_not_found", message: "no such voucher" },
      });
    }
    return Promise.resolve({ ok: true, data: preview });
  },
  authorize: (params) => {
    const preview = mockPreviewFor(params.code);
    if (!preview) {
      return Promise.resolve({
        ok: false,
        error: { kind: "http", status: 404, code: "voucher_not_found", message: "no such voucher" },
      });
    }
    const authorizationId = `mock_auth_${crypto.randomUUID()}`;
    const brandedAmount = toMinorUnits(params.amountMinor);
    MOCK_HELD.set(authorizationId, {
      preview,
      amountMinor: brandedAmount,
      orderRef: params.orderRef,
    });
    return Promise.resolve({
      ok: true,
      data: {
        authorizationId,
        voucherId: preview.voucherId,
        amountMinor: brandedAmount,
        currency: params.currency,
        expiresAt: new Date(Date.now() + 5 * 60_000).toISOString(),
      },
    });
  },
  capture: ({ authorizationId }) => {
    const held = MOCK_HELD.get(authorizationId);
    if (!held) {
      return Promise.resolve({
        ok: false,
        error: {
          kind: "http",
          status: 404,
          code: "authorization_not_found",
          message: "that authorization has expired or does not exist",
        },
      });
    }
    MOCK_HELD.delete(authorizationId);
    const capturedAt = new Date().toISOString();
    const entry: CounterLogEntry = {
      captureId: `mock_cap_${crypto.randomUUID()}`,
      voucherId: held.preview.voucherId,
      amountMinor: held.amountMinor,
      currency: held.preview.currency,
      capturedAt,
      orderRef: held.orderRef,
      authorizedAt: capturedAt,
    };
    MOCK_LOG.unshift(entry);
    return Promise.resolve({
      ok: true,
      data: {
        captureId: entry.captureId,
        voucherId: entry.voucherId,
        amountMinor: entry.amountMinor,
        currency: entry.currency,
        capturedAt: entry.capturedAt,
        orderRef: entry.orderRef,
      },
    });
  },
  log: () => Promise.resolve({ ok: true, data: { entries: [...MOCK_LOG] } }),
};

const NOT_IMPLEMENTED = (path: string): ApiResult<never> => ({
  ok: false,
  error: {
    kind: "http",
    status: 501,
    code: "not_implemented",
    message: `Live counter redemption is not implemented yet — ${path} has no route on main (TASKS.md 8.2.b, still on phase/8).`,
  },
});

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

const liveDataSource: CounterDataSource = {
  lookup: (code) =>
    withDeviceAuth((authorization) =>
      apiFetch("/api/counter/lookup", counterVoucherPreviewSchema, {
        method: "POST",
        headers: { authorization },
        body: { code },
      }),
    ),
  authorize: ({ idempotencyKey, ...body }) =>
    withDeviceAuth((authorization) =>
      apiFetch("/api/counter/authorize", counterAuthorizationSchema, {
        method: "POST",
        headers: { authorization, "idempotency-key": idempotencyKey },
        body,
      }),
    ),
  capture: ({ authorizationId, idempotencyKey }) =>
    withDeviceAuth((authorization) =>
      apiFetch("/api/counter/capture", counterCaptureSchema, {
        method: "POST",
        headers: { authorization, "idempotency-key": idempotencyKey },
        body: { authorizationId },
      }),
    ),
  log: () =>
    withDeviceAuth((authorization) =>
      apiFetch("/api/counter/log", counterLogResultSchema, { headers: { authorization } }),
    ),
};

const dataSourceOrNotImplemented: CounterDataSource = {
  lookup: (code) => liveDataSource.lookup(code).catch(() => NOT_IMPLEMENTED("/api/counter/lookup")),
  authorize: (params) =>
    liveDataSource.authorize(params).catch(() => NOT_IMPLEMENTED("/api/counter/authorize")),
  capture: (params) =>
    liveDataSource.capture(params).catch(() => NOT_IMPLEMENTED("/api/counter/capture")),
  log: () => liveDataSource.log().catch(() => NOT_IMPLEMENTED("/api/counter/log")),
};

const counterDataSource = resolveDataSource({
  mock: mockDataSource,
  live: dataSourceOrNotImplemented,
});

export async function counterLookupAction(code: string): Promise<ApiResult<CounterVoucherPreview>> {
  return counterDataSource.lookup(code);
}

export async function counterAuthorizeAction(
  params: CounterAuthorizeParams,
): Promise<ApiResult<CounterAuthorization>> {
  return counterDataSource.authorize(params);
}

export async function counterCaptureAction(
  params: CounterCaptureParams,
): Promise<ApiResult<CounterCapture>> {
  return counterDataSource.capture(params);
}

export async function counterLogAction(): Promise<ApiResult<{ entries: CounterLogEntry[] }>> {
  return counterDataSource.log();
}
