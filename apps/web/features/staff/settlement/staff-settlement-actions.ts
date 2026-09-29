"use server";

import type { Route } from "next";
import { redirect } from "next/navigation";
import type { ZodType } from "zod";
import { economyProposalSchema } from "@yourtal/contracts/staff/economy";
import { statementSchema } from "@yourtal/contracts/ledger-internal/economy";
import { apiFetch } from "@/lib/api/api-fetch";

/**
 * TASKS.md 10.6.a: every propose/approve/resolve action is a plain
 * `<form action={...}>`, same shape 9.5's `staff-economy-actions.ts` uses.
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

function settlementRoute(region: string, flag: string): Route {
  return `/staff/settlement?region=${region}&${flag}=1` as Route;
}

async function post<T>(path: string, idempotencyKey: string, body: unknown, schema: ZodType<T>) {
  return apiFetch(path, schema, {
    method: "POST",
    headers: { "idempotency-key": idempotencyKey },
    body,
  });
}

// -- resolving a statement's own dispute --

export async function resolveStatementDisputeAction(formData: FormData): Promise<void> {
  const region = requireRegion(formData);
  const statementId = requireField(formData, "statementId");
  const idempotencyKey = requireField(formData, "idempotencyKey");
  const note = requireField(formData, "note");
  const result = await post(
    `/api/staff/settlement/statements/${statementId}/resolve-dispute`,
    idempotencyKey,
    { note },
    statementSchema,
  );
  redirect(settlementRoute(region, result.ok ? "resolved" : "error"));
}

// -- payout approval, two-person --

export async function proposePayoutAction(formData: FormData): Promise<void> {
  const region = requireRegion(formData);
  const statementId = requireField(formData, "statementId");
  const idempotencyKey = requireField(formData, "idempotencyKey");
  const reason = stringField(formData, "reason");
  const result = await post(
    `/api/staff/settlement/${region}/statements/${statementId}/payout-proposals`,
    idempotencyKey,
    reason === undefined ? {} : { reason },
    economyProposalSchema,
  );
  redirect(settlementRoute(region, result.ok ? "proposed" : "error"));
}

export async function approvePayoutAction(formData: FormData): Promise<void> {
  const region = requireRegion(formData);
  const proposalId = requireField(formData, "proposalId");
  const idempotencyKey = requireField(formData, "idempotencyKey");
  const result = await post(
    `/api/staff/settlement/${region}/payout-proposals/${proposalId}/approve`,
    idempotencyKey,
    {},
    economyProposalSchema,
  );
  redirect(settlementRoute(region, result.ok ? "approved" : "error"));
}
