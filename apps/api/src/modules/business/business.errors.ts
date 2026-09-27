/**
 * Discriminated unions on `type` for every expected failure this module's
 * use-cases can produce (docs/13b section 4). `business.controller.ts` is
 * the one adapter that maps these to HTTP — see `to-http-exception.ts`.
 */

export interface BusinessNotFoundError {
  readonly type: "business_not_found";
  readonly businessId: string;
}

export interface PersistenceFailedError {
  readonly type: "persistence_failed";
  readonly cause: string;
}

/** TASKS.md 7.1.c: a second invite to the same address while the first is still open (migration's partial unique index backs this up). */
export interface InvitationAlreadyOpenError {
  readonly type: "invitation_already_open";
  readonly email: string;
}

/** A target for `transfer_ownership` who does not (yet) hold any role at this business. */
export interface TargetNotMemberError {
  readonly type: "target_not_member";
  readonly userId: string;
}

export interface MemberNotFoundError {
  readonly type: "member_not_found";
  readonly userId: string;
}

export interface CannotRemoveOwnerError {
  readonly type: "cannot_remove_owner";
}

/**
 * YT-0580: the owner role moves only through `transfer_ownership`, never
 * `change_role`. This is the demotion half of that invariant — the target's
 * STORED role is "owner" and the caller is trying to change it to anything
 * else. See the guard in `change-member-role.use-case.ts` and the comment
 * there for why this exists alongside the `team.yaml` PDP rule rather than
 * instead of it.
 */
export interface CannotChangeOwnerRoleError {
  readonly type: "cannot_change_owner_role";
}

export type CreateBusinessError = PersistenceFailedError;

export type InviteMemberError =
  BusinessNotFoundError | InvitationAlreadyOpenError | PersistenceFailedError;

export type TransferOwnershipError =
  BusinessNotFoundError | TargetNotMemberError | PersistenceFailedError;

/** Not found, already accepted/revoked, or expired -- collapsed per YT-0153 enumeration discipline, same as auth's token_invalid. */
export interface InvitationInvalidError {
  readonly type: "invitation_invalid";
}

export type AcceptInvitationError = InvitationInvalidError | PersistenceFailedError;

/**
 * No separate `cannot_grant_owner_via_change_role` case: `GrantableRole`
 * excludes `"owner"` at the type level (see `business-member.repository.ts`),
 * and the request DTO enforces the same thing with `.exclude(["owner"])`.
 * The `team.yaml` Cerbos rule denies granting owner this way too,
 * redundantly and deliberately (policies/README, "On DENY rules that look
 * redundant") — this use-case does not need a third copy of that half of
 * the invariant.
 *
 * The OTHER half — demoting the target when their stored role already IS
 * owner — is not covered by any of the above (YT-0580), which is why
 * `CannotChangeOwnerRoleError` exists and is in this union.
 */
export type ChangeMemberRoleError =
  BusinessNotFoundError | MemberNotFoundError | CannotChangeOwnerRoleError | PersistenceFailedError;

export type RemoveMemberError =
  BusinessNotFoundError | MemberNotFoundError | CannotRemoveOwnerError | PersistenceFailedError;

export type GetBusinessProfileError = BusinessNotFoundError | PersistenceFailedError;

export type ListTeamError = BusinessNotFoundError | PersistenceFailedError;

export type SetBillingContactError = BusinessNotFoundError | PersistenceFailedError;

/** TASKS.md 7.1.b: `storageRef` names an object nothing was ever uploaded to. */
export interface StorageRefNotUploadedError {
  readonly type: "storage_ref_not_uploaded";
  readonly storageRef: string;
}

export type SubmitKybDocumentError =
  BusinessNotFoundError | StorageRefNotUploadedError | PersistenceFailedError;

export type ListKybDocumentsError = BusinessNotFoundError | PersistenceFailedError;
