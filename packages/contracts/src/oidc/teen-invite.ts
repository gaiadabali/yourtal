import * as z from "zod";

/**
 * Group 3.9.e (docs/26 §3.3): the teen invite API, for SnapApp's server only.
 * Authenticated by a client-credentials access token with scope
 * `teen_invites` (`Authorization: Bearer …`), never a session. Every `sub`
 * here is the app's own pairwise `sub`.
 */
const subSchema = z.string().min(1).max(255);

/** `POST /api/oidc-clients/teen-invites` and `POST …/{inviteId}/end`. */
export const teenInviteParentRequestSchema = z.object({ parentSub: subSchema }).strict();
export type TeenInviteParentRequest = z.infer<typeof teenInviteParentRequestSchema>;

/**
 * `201` from create. `code` is the one-time code for the join link: 128 bits,
 * valid 7 days, shown once and kept by YourTal only as a hash. A replay of the
 * same Idempotency-Key answers without it, because it is never stored; create
 * a new invite instead.
 */
export const teenInviteCreatedSchema = z.object({
  inviteId: z.uuid(),
  code: z.string().min(1).optional(),
  expiresAt: z.iso.datetime({ offset: true }),
});
export type TeenInviteCreated = z.infer<typeof teenInviteCreatedSchema>;

export const teenInviteStatusSchema = z.enum(["pending", "accepted", "expired", "ended"]);
export type TeenInviteStatus = z.infer<typeof teenInviteStatusSchema>;

/** `GET /api/oidc-clients/teen-invites/{inviteId}`. `teenSub` once a teen has accepted it. */
export const teenInviteSchema = z.object({
  inviteId: z.uuid(),
  status: teenInviteStatusSchema,
  teenSub: subSchema.nullable(),
});
export type TeenInvite = z.infer<typeof teenInviteSchema>;
