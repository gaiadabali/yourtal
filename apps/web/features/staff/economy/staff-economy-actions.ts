"use server";

import type { Route } from "next";
import { redirect } from "next/navigation";
import type { ZodType } from "zod";
import { economyProposalSchema } from "@yourtal/contracts/staff/economy";
import { killSwitchSchema } from "@yourtal/contracts/voucher-internal/kill-switch";
import { apiFetch } from "@/lib/api/api-fetch";

/**
 * TASKS.md 9.5.b/c/d: every propose/approve action is a plain
 * `<form action={...}>`, same shape 9.4's `staff-user-actions.ts` uses.
 * `idempotencyKey` is a hidden field the page mints once per render.
 */

function stringField(formData: FormData, name: string): string | undefined {
  const value = formData.get(name);
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function requireField(formData: FormData, name: string): string {
  const value = stringField(formData, name);
  if (value === undefined) throw new Error(`missing required field ${name}`);
  return value;
}

function requireRegion(formData: FormData): "AU" | "ID" {
  const region = requireField(formData, "region");
  if (region !== "AU" && region !== "ID") throw new Error("invalid region");
  return region;
}

function economyRoute(path: string, flag: string): Route {
  return `${path}?${flag}=1` as Route;
}

async function post<T>(path: string, idempotencyKey: string, body: unknown, schema: ZodType<T>) {
  return apiFetch(path, schema, {
    method: "POST",
    headers: { "idempotency-key": idempotencyKey },
    body,
  });
}

// -- 9.5.b: rate changes --

export async function proposeRateAction(formData: FormData): Promise<void> {
  const region = requireRegion(formData);
  const idempotencyKey = requireField(formData, "idempotencyKey");
  const backingRateMicrosPerPoint = Number(requireField(formData, "backingRateMicrosPerPoint"));
  const reason = stringField(formData, "reason");
  if (!Number.isInteger(backingRateMicrosPerPoint) || backingRateMicrosPerPoint <= 0) {
    redirect(economyRoute("/staff/economy/rate", "invalid"));
  }
  const result = await post(
    `/api/staff/economy/${region}/rate/proposals`,
    idempotencyKey,
    { backingRateMicrosPerPoint, ...(reason === undefined ? {} : { reason }) },
    economyProposalSchema,
  );
  redirect(economyRoute("/staff/economy/rate", result.ok ? "proposed" : "error"));
}

export async function approveRateAction(formData: FormData): Promise<void> {
  const region = requireRegion(formData);
  const id = requireField(formData, "proposalId");
  const idempotencyKey = requireField(formData, "idempotencyKey");
  const result = await post(
    `/api/staff/economy/${region}/rate/proposals/${id}/approve`,
    idempotencyKey,
    {},
    economyProposalSchema,
  );
  redirect(economyRoute("/staff/economy/rate", result.ok ? "approved" : "error"));
}

// -- 9.5.c: marketing funding --

export async function proposeMarketingFundingAction(formData: FormData): Promise<void> {
  const region = requireRegion(formData);
  const idempotencyKey = requireField(formData, "idempotencyKey");
  const amountMinor = Number(requireField(formData, "amountMinor"));
  const reason = requireField(formData, "reason");
  if (!Number.isInteger(amountMinor) || amountMinor <= 0) {
    redirect(economyRoute("/staff/economy/marketing", "invalid"));
  }
  const result = await post(
    `/api/staff/economy/${region}/marketing-fundings`,
    idempotencyKey,
    { amountMinor, reason },
    economyProposalSchema,
  );
  redirect(economyRoute("/staff/economy/marketing", result.ok ? "proposed" : "error"));
}

export async function approveMarketingFundingAction(formData: FormData): Promise<void> {
  const region = requireRegion(formData);
  const id = requireField(formData, "proposalId");
  const idempotencyKey = requireField(formData, "idempotencyKey");
  const result = await post(
    `/api/staff/economy/${region}/marketing-fundings/${id}/approve`,
    idempotencyKey,
    {},
    economyProposalSchema,
  );
  redirect(economyRoute("/staff/economy/marketing", result.ok ? "approved" : "error"));
}

// -- 9.5.c: manual point purchase --

export async function proposeManualPurchaseAction(formData: FormData): Promise<void> {
  const region = requireRegion(formData);
  const idempotencyKey = requireField(formData, "idempotencyKey");
  const businessId = requireField(formData, "businessId");
  const points = Number(requireField(formData, "points"));
  const paidMinor = Number(requireField(formData, "paidMinor"));
  const bankReference = requireField(formData, "bankReference");
  const reason = stringField(formData, "reason");
  if (!Number.isInteger(points) || points <= 0 || !Number.isInteger(paidMinor) || paidMinor <= 0) {
    redirect(economyRoute("/staff/economy", "invalid"));
  }
  const result = await post(
    `/api/staff/economy/${region}/purchases`,
    idempotencyKey,
    { businessId, points, paidMinor, bankReference, ...(reason === undefined ? {} : { reason }) },
    economyProposalSchema,
  );
  redirect(economyRoute("/staff/economy", result.ok ? "proposed" : "error"));
}

export async function approveManualPurchaseAction(formData: FormData): Promise<void> {
  const region = requireRegion(formData);
  const id = requireField(formData, "proposalId");
  const idempotencyKey = requireField(formData, "idempotencyKey");
  const result = await post(
    `/api/staff/economy/${region}/purchases/${id}/approve`,
    idempotencyKey,
    {},
    economyProposalSchema,
  );
  redirect(economyRoute("/staff/economy", result.ok ? "approved" : "error"));
}

// -- 9.5.d: region settings, including points expiry --

export async function proposeSettingAction(formData: FormData): Promise<void> {
  const region = requireRegion(formData);
  const idempotencyKey = requireField(formData, "idempotencyKey");
  const key = requireField(formData, "key");
  const rawValue = requireField(formData, "value");
  const reason = stringField(formData, "reason");
  let value: unknown;
  try {
    value = JSON.parse(rawValue);
  } catch {
    redirect(economyRoute("/staff/economy/settings", "invalid"));
  }
  const result = await post(
    `/api/staff/economy/${region}/settings/proposals`,
    idempotencyKey,
    { key, value, ...(reason === undefined ? {} : { reason }) },
    economyProposalSchema,
  );
  redirect(economyRoute("/staff/economy/settings", result.ok ? "proposed" : "error"));
}

export async function approveSettingAction(formData: FormData): Promise<void> {
  const region = requireRegion(formData);
  const id = requireField(formData, "proposalId");
  const idempotencyKey = requireField(formData, "idempotencyKey");
  const result = await post(
    `/api/staff/economy/${region}/settings/proposals/${id}/approve`,
    idempotencyKey,
    {},
    economyProposalSchema,
  );
  redirect(economyRoute("/staff/economy/settings", result.ok ? "approved" : "error"));
}

// -- 9.5.c: kill switches -- ops only, single action --

export async function tripKillSwitchAction(formData: FormData): Promise<void> {
  const idempotencyKey = requireField(formData, "idempotencyKey");
  const scope = requireField(formData, "scope");
  const targetId = stringField(formData, "targetId") ?? null;
  const reason = requireField(formData, "reason");
  const active = stringField(formData, "active") === "true";
  const result = await post(
    "/api/staff/economy/kill-switches",
    idempotencyKey,
    { scope, targetId, reason, active },
    killSwitchSchema,
  );
  redirect(economyRoute("/staff/economy/marketing", result.ok ? "killSwitch" : "error"));
}
