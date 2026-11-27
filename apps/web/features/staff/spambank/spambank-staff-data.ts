import "server-only";
import { forbidden } from "next/navigation";
import { apiFetch } from "@/lib/api/api-fetch";
import type { LeadStatus } from "./spambank-lead-statuses";
import {
  spambankAutoreplySchema,
  spambankLeadPageSchema,
  type SpambankAutoreply,
  type SpambankLeadPage,
} from "./spambank-staff-contract";

/** Every reader returns `null` when Spambank is off or not deployed (404/503), so the page can say so. */
function unavailable(error: { kind: string; status?: number }): boolean {
  return error.kind === "http" && (error.status === 404 || error.status === 503);
}

export interface LeadQuery {
  readonly status?: LeadStatus;
  readonly q?: string;
  readonly cursor?: string;
}

export function leadQueryString(query: LeadQuery): string {
  const params = new URLSearchParams();
  if (query.status !== undefined) params.set("status", query.status);
  if (query.q !== undefined && query.q !== "") params.set("q", query.q);
  if (query.cursor !== undefined && query.cursor !== "") params.set("cursor", query.cursor);
  const text = params.toString();
  return text === "" ? "" : `?${text}`;
}

/**
 * BUILD.md 4.7/5.4: the leads for the staff member's own region (the API
 * scopes by the principal's jurisdiction, so no region is sent). `ops` and
 * `support` only -- anyone else gets the API's 403 and the console's 403 page.
 */
export async function listSpambankLeads(query: LeadQuery): Promise<SpambankLeadPage | null> {
  const result = await apiFetch(
    `/api/staff/spambank/leads${leadQueryString(query)}`,
    spambankLeadPageSchema,
  );
  if (result.ok) return result.data;
  if (result.error.kind === "http" && result.error.status === 403) forbidden();
  if (unavailable(result.error)) return null;
  throw new Error(`Could not load the Spambank leads: ${result.error.message}`);
}

/** BUILD.md 5.4: the auto-reply engine's mode, pause state, today's counts and last blocklist checks. */
export async function getSpambankAutoreply(): Promise<SpambankAutoreply | null> {
  const result = await apiFetch("/api/staff/spambank/autoreply", spambankAutoreplySchema);
  if (result.ok) return result.data;
  if (result.error.kind === "http" && result.error.status === 403) forbidden();
  if (unavailable(result.error)) return null;
  throw new Error(`Could not load the auto-reply controls: ${result.error.message}`);
}
