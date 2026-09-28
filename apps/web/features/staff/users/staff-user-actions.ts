"use server";

import type { Route } from "next";
import { redirect } from "next/navigation";
import {
  goodwillResultSchema,
  releaseUserResultSchema,
  setTrustTierResultSchema,
  suspendUserResultSchema,
} from "@yourtal/contracts/staff/users";
import { apiFetch } from "@/lib/api/api-fetch";

/**
 * TASKS.md 9.4.b-d: suspend, release, goodwill and trust-tier, each a plain
 * `<form action={...}>` on the user detail page. `idempotencyKey` is a
 * hidden field the page mints once per render (same convention
 * `purchase-points-action.ts` uses), so a double-click of the same rendered
 * button replays rather than double-acts.
 */

function stringField(formData: FormData, name: string): string | undefined {
  const value = formData.get(name);
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function requireField(formData: FormData, name: string): string {
  const value = stringField(formData, name);
  if (value === undefined) redirect(backTo(formData, "invalid"));
  return value;
}

/** Every route under `/staff/users/[userId]` is dynamic, so typed routes need the cast. */
function userRoute(userId: string, flag: string): Route {
  return `/staff/users/${userId}?${flag}=1` as Route;
}

function backTo(formData: FormData, flag: string): Route {
  const userId = stringField(formData, "userId") ?? "";
  return userRoute(userId, flag);
}

export async function suspendUserAction(formData: FormData): Promise<void> {
  const userId = requireField(formData, "userId");
  const reason = requireField(formData, "reason");
  const idempotencyKey = requireField(formData, "idempotencyKey");

  const result = await apiFetch(`/api/staff/users/${userId}/suspend`, suspendUserResultSchema, {
    method: "POST",
    headers: { "idempotency-key": idempotencyKey },
    body: { reason },
  });
  redirect(userRoute(userId, result.ok ? "suspended" : "error"));
}

export async function releaseUserAction(formData: FormData): Promise<void> {
  const userId = requireField(formData, "userId");
  const idempotencyKey = requireField(formData, "idempotencyKey");

  const result = await apiFetch(`/api/staff/users/${userId}/release`, releaseUserResultSchema, {
    method: "POST",
    headers: { "idempotency-key": idempotencyKey },
  });
  redirect(userRoute(userId, result.ok ? "released" : "error"));
}

export async function goodwillAction(formData: FormData): Promise<void> {
  const userId = requireField(formData, "userId");
  const reason = requireField(formData, "reason");
  const idempotencyKey = requireField(formData, "idempotencyKey");
  const pointsRaw = requireField(formData, "points");
  const points = Number(pointsRaw);
  if (!Number.isFinite(points) || points <= 0) redirect(backTo(formData, "invalid"));

  const result = await apiFetch(`/api/staff/users/${userId}/goodwill`, goodwillResultSchema, {
    method: "POST",
    headers: { "idempotency-key": idempotencyKey },
    body: { points, reason },
  });
  redirect(userRoute(userId, result.ok ? "goodwill" : "error"));
}

export async function setTrustTierAction(formData: FormData): Promise<void> {
  const userId = requireField(formData, "userId");
  const reason = requireField(formData, "reason");
  const idempotencyKey = requireField(formData, "idempotencyKey");
  const trustTierRaw = requireField(formData, "trustTier");
  const trustTier = Number(trustTierRaw);
  if (![0, 1, 2, 3].includes(trustTier)) redirect(backTo(formData, "invalid"));

  const result = await apiFetch(
    `/api/staff/users/${userId}/trust-tier`,
    setTrustTierResultSchema,
    {
      method: "POST",
      headers: { "idempotency-key": idempotencyKey },
      body: { trustTier, reason },
    },
  );
  redirect(userRoute(userId, result.ok ? "trust_tier" : "error"));
}
