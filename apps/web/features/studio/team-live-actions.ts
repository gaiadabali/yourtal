"use server";

import { z } from "zod";
import { businessMemberSchema } from "@yourtal/contracts/business/member";
import type { BusinessMember } from "@yourtal/contracts/business/member";
import { businessTeamRoleSchema } from "@yourtal/contracts/business/team-role";
import type { BusinessTeamRole } from "@yourtal/contracts/business/team-role";
import { apiFetch } from "@/lib/api/api-fetch";
import type { ApiError } from "@/lib/api/api-fetch";
import type { TeamActionError } from "./team-errors";

/**
 * The real `apps/api/src/modules/business/{team-invite,team-member,
 * team-ownership}.controller.ts` endpoints (7.1.c/7.1.d, merged to `main`),
 * called from `team-screen.tsx` — a `"use client"` leaf — as Server
 * Actions, the same shape `media-upload-actions.ts` uses for 7.2's real
 * upload endpoints. `team-actions.ts`'s pure functions stay as they are and
 * keep running the MOCK flow (`YOURTAL_DATA_SOURCE=mock`, the default); this
 * module is the live counterpart `team-screen.tsx` calls instead once
 * `isLiveMode` is true, matching the branch `campaign-editor-upload.tsx`
 * already does for its own upload.
 */
export type TeamLiveActionResult<T> =
  { ok: true; value: T } | { ok: false; error: TeamActionError };

/**
 * Maps a real API refusal onto the same `TeamActionError` union the mock
 * flow already uses, so `team-error-message.tsx`'s existing switch renders
 * every live refusal too — no second error-copy surface. Codes with no
 * direct one-to-one mapping (the PDP's generic `forbidden`, an
 * `invitation_already_open` this call has no `email` for, anything
 * unexpected) fall through to `api_error`, which shows the server's own
 * message rather than pretending nothing went wrong.
 */
function mapApiError(error: ApiError, context: { email?: string } = {}): TeamActionError {
  if (error.kind === "http") {
    switch (error.code) {
      case "cannot_remove_owner":
        return { type: "cannot_remove_owner" };
      case "cannot_change_owner_role":
        return { type: "cannot_target_owner_role" };
      case "invitation_already_open":
        if (context.email) return { type: "already_on_roster", email: context.email };
        break;
      default:
        break;
    }
  }
  return { type: "api_error", message: error.message };
}

const invitationResponseSchema = z.object({
  id: z.string(),
  businessId: z.string(),
  email: z.string(),
  role: businessTeamRoleSchema,
  invitedAt: z.string(),
  expiresAt: z.string(),
});
export type TeamInvitationSummary = z.infer<typeof invitationResponseSchema>;

/** `POST /api/:tenantId/business/team/invite` (7.1.c) — `@Idempotent`, so a fresh key per call (one logical invite, no retry reuse needed here). */
export async function inviteMemberLive(
  businessId: string,
  email: string,
  role: Exclude<BusinessTeamRole, "owner">,
): Promise<TeamLiveActionResult<TeamInvitationSummary>> {
  const result = await apiFetch(
    `/api/${businessId}/business/team/invite`,
    invitationResponseSchema,
    {
      method: "POST",
      headers: { "idempotency-key": crypto.randomUUID() },
      body: { email, role },
    },
  );
  if (!result.ok) return { ok: false, error: mapApiError(result.error, { email }) };
  return { ok: true, value: result.data };
}

/** `PATCH /api/:tenantId/business/team/:userId/role` (7.1.d) — `@NotValueMoving`, no idempotency key needed. */
export async function changeMemberRoleLive(
  businessId: string,
  userId: string,
  role: Exclude<BusinessTeamRole, "owner">,
): Promise<TeamLiveActionResult<BusinessMember>> {
  const result = await apiFetch(
    `/api/${businessId}/business/team/${userId}/role`,
    businessMemberSchema,
    { method: "PATCH", body: { role } },
  );
  if (!result.ok) return { ok: false, error: mapApiError(result.error) };
  return { ok: true, value: result.data };
}

const removedResponseSchema = z.object({ removed: z.literal(true) });

/** `DELETE /api/:tenantId/business/team/:userId` (7.1.d) — `@NotValueMoving`, no idempotency key needed. */
export async function removeMemberLive(
  businessId: string,
  userId: string,
): Promise<TeamLiveActionResult<null>> {
  const result = await apiFetch(
    `/api/${businessId}/business/team/${userId}`,
    removedResponseSchema,
    { method: "DELETE" },
  );
  if (!result.ok) return { ok: false, error: mapApiError(result.error) };
  return { ok: true, value: null };
}

const transferResultSchema = z.object({
  previousOwner: businessMemberSchema,
  newOwner: businessMemberSchema,
});
export type TransferOwnershipResult = z.infer<typeof transferResultSchema>;

/**
 * `POST /api/:tenantId/business/team/transfer-ownership` (7.1.d) —
 * `@NotValueMoving`, no idempotency key needed. Real and PDP-gated today,
 * but `team.yaml`'s `ownership-transfer-needs-fresh-reauth` rule denies it
 * outright until step-up re-authentication exists (YT-0540/0541) — every
 * live call currently comes back `forbidden` (`api_error`), which is the
 * honest state, not a bug in this wiring.
 */
export async function transferOwnershipLive(
  businessId: string,
  newOwnerUserId: string,
): Promise<TeamLiveActionResult<TransferOwnershipResult>> {
  const result = await apiFetch(
    `/api/${businessId}/business/team/transfer-ownership`,
    transferResultSchema,
    { method: "POST", body: { newOwnerUserId } },
  );
  if (!result.ok) return { ok: false, error: mapApiError(result.error) };
  return { ok: true, value: result.data };
}
