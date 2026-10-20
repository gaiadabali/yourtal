"use server";

import type { Route } from "next";
import { redirect } from "next/navigation";
import type { ZodType } from "zod";
import { economyProposalSchema } from "@yourtal/contracts/staff/economy";
import {
  checkDisbursementResultSchema,
  type CheckDisbursementOutcome,
} from "@yourtal/contracts/staff/settlement";
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

// -- 5.2.c: a payout never in flight unseen. Called from a client button, so they answer with a result, not a redirect. --

export type DisbursementActionResult =
  { ok: true; outcome?: CheckDisbursementOutcome } | { ok: false; message: string };

function regionOrThrow(region: string): "AU" | "ID" {
  if (region !== "AU" && region !== "ID") throw new Error("invalid region");
  return region;
}

/** "Check again": reads the payout back from the processor. Single-person; moves no money. */
export async function checkDisbursementAction(
  region: string,
  disbursementId: string,
): Promise<DisbursementActionResult> {
  const result = await post(
    `/api/staff/settlement/${regionOrThrow(region)}/disbursements/${encodeURIComponent(disbursementId)}/check`,
    crypto.randomUUID(),
    {},
    checkDisbursementResultSchema,
  );
  return result.ok
    ? { ok: true, outcome: result.data.outcome }
    : { ok: false, message: result.error.message };
}

/** Proposes a new payout attempt (two-person). `""` message means the reason was unusable. */
export async function proposeRetryAction(
  region: string,
  disbursementId: string,
  reason: string,
): Promise<DisbursementActionResult> {
  const trimmed = reason.trim();
  if (trimmed === "" || trimmed.length > 500) return { ok: false, message: "" };
  const result = await post(
    `/api/staff/settlement/${regionOrThrow(region)}/disbursements/${encodeURIComponent(disbursementId)}/retry-proposals`,
    crypto.randomUUID(),
    { reason: trimmed },
    economyProposalSchema,
  );
  return result.ok ? { ok: true } : { ok: false, message: result.error.message };
}

/** A second staff member approves (the payout is attempted once) or rejects the pending retry. */
export async function decideRetryAction(
  region: string,
  proposalId: string,
  decision: "approve" | "reject",
): Promise<DisbursementActionResult> {
  const result = await post(
    `/api/staff/settlement/${regionOrThrow(region)}/retry-proposals/${encodeURIComponent(proposalId)}/${decision}`,
    crypto.randomUUID(),
    {},
    economyProposalSchema,
  );
  return result.ok ? { ok: true } : { ok: false, message: result.error.message };
}
