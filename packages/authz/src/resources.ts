/**
 * Every resource kind the PDP knows about, and every action defined on it.
 *
 * This registry is the TypeScript half of a contract whose other half is
 * `policies/resource_policies/*.yaml`. `policy-drift.test.ts` asserts the
 * two are identical in both directions:
 *
 *   - an action here with no rule mentioning it in the policy repo would be
 *     permanently DENY, which is a silently broken endpoint; and
 *   - an action in the policy repo that is missing here is a rule nobody can
 *     reach, which is a false sense of coverage.
 *
 * That check is what makes "never ad hoc" mechanical rather than cultural:
 * a service cannot invent an action string, because `checkResource` will not
 * type-check against one, and it cannot add an action to this file without
 * writing the policy rule that answers it.
 *
 * Kind names and action names are snake_case to match the policy YAML
 * exactly — this is the one place in the TypeScript codebase where the
 * camelCase rule in docs/13b section 6 does not apply, because these strings
 * cross a boundary into a different language.
 */

export const RESOURCE_ACTIONS = {
  /**
   * A business's own profile -- legal name, display name, district, logo.
   * Distinct from `team` (the roster) and `billing` (the spend). `view`
   * reaches all six office roles from docs/17 section 2.1; `edit` is
   * owner/admin, same as the Team zone's edit column.
   */
  /**
   * `list_own` (TASKS.md 7.1.b): `GET /api/me/businesses`. No single
   * businessId to scope against -- the endpoint itself filters to real,
   * joined memberships read from the database -- same "caller IS the
   * resource, nothing narrower to check" shape as `create` below.
   *
   * `suspend`/`reinstate` (TASKS.md 9.3.a): staff-only. A suspended business
   * cannot submit or spend and its campaigns leave the feed -- see
   * `business.yaml`'s `ops-reviews-and-moderates-any-business` rule.
   */
  business: ["view", "edit", "create", "list_own", "suspend", "reinstate"],

  /**
   * KYB onboarding documents. Submitted and read by the business
   * (owner/admin); reviewed by `ops` (docs/17 section 5). A business can
   * never approve or reject its own submission -- see the DENY rule in
   * `kyb_document.yaml`.
   */
  kyb_document: ["view", "submit", "approve", "reject"],

  /**
   * Uploaded campaign media (raw source, then its transcoded renditions).
   * TASKS.md 7.2 -- same editors as `campaign` itself (owner/admin/marketer),
   * since an asset exists to become a campaign's video and has no separate
   * lifecycle a different role should govern.
   */
  media_asset: ["upload", "view"],

  /** Business-side campaign management and its question bank. */
  campaign: [
    "view",
    "create",
    "edit",
    "edit_questions",
    "submit_for_review",
    "publish",
    "pause",
    "archive",
    "view_performance",
  ],

  /** Consumer and anonymous playback. docs/17 section 4, Open Viewing. */
  campaign_view: ["watch_open", "watch_rewarded", "earn", "answer_scored", "resume_session"],

  /**
   * Store inventory and settlement values.
   *
   * `request_settlement_decrease` (YT-0575) is the propose half of the
   * two-person-approval workflow `approve_settlement_decrease` has always
   * named. It is deliberately its own action rather than folded into
   * `set_settlement_value`: `merchandisers-run-inventory`'s condition
   * denies `set_settlement_value` outright for a material change (YT-0574),
   * full stop, so there had to be a different action for the thing a
   * material change IS allowed to do -- raise a request that is not
   * applied. Same shape as `voucher_batch`'s `request_issuance` /
   * `approve_issuance` split.
   */
  listing: [
    "view",
    "create",
    "edit",
    "archive",
    "set_settlement_value",
    "request_settlement_decrease",
    "approve_settlement_decrease",
    "approve_listing",
    "reject_listing",
    // 12.1.b: the PUBLIC consumer read (StoreCatalogueController) -- a
    // DIFFERENT action from `view` on purpose. `view` above is the
    // merchant's own back-office read (business_inventory_viewer_of/ops
    // derived roles); every signed-in principal also carries the plain
    // "user" role (AsyncPrincipalResolver), so an audience-gated ALLOW
    // scoped to roles ["user","anonymous"] on the SAME action would let any
    // consumer pass the merchant's own inventory-view check merely by
    // matching a listing's audience. Same split as campaign/campaign_view.
    "browse",
  ],

  /**
   * Bulk voucher issuance, two-person approved. `reject_issuance` (TASKS.md
   * 9.2.c): staff-only, the other half of the moderation queue's decision --
   * see `voucher_batch.yaml`'s `moderator-reviews-a-batch` rule.
   */
  voucher_batch: ["view", "request_issuance", "approve_issuance", "reject_issuance", "void"],

  /** A business's own outlets (YT-0502) -- what a listing's `locationIds` reference. */
  merchant_location: ["view", "create", "edit", "archive"],

  /** A consumer's own balance, history and vouchers. */
  wallet: ["view", "view_history", "redeem", "transfer", "receive_voucher"],

  /**
   * The merchant redemption network and its credentials. Note the absence of
   * any balance-lookup action: docs/14 section 6 forbids an endpoint that
   * answers "is this code valid" without moving value, because that is a
   * free enumeration oracle. `lookup` is the staff-authenticated, rate-
   * limited, audited portal lookup — not an anonymous code check.
   */
  redemption: [
    "authorize",
    "capture",
    "void",
    "refund",
    "lookup",
    "view_log",
    "view_credential",
    "rotate_credential",
    "approve_credential_rotation",
    // TASKS.md 8.3.a (Studio -> Developers): the voucher service's own
    // credential_routes.go has issue/rotate/revoke but no matching PDP
    // action existed for the third one — issue is gated the same way a
    // create always is (no resource yet, `view_credential` on the
    // business), rotate already had its action; revoke did not.
    "revoke_credential",
  ],

  report: ["view", "export"],

  billing: [
    "view",
    "view_statement",
    "purchase_points",
    "raise_dispute",
    "update_payment_method",
    // TASKS.md 10.6.a: the staff console's own settlement queue and dispute
    // resolution -- finance/ops, never a business role (billing.yaml's own
    // `staff-work-the-settlement-queue` rule).
    "view_statement_queue",
    "resolve_dispute",
  ],

  team: [
    "view",
    "invite",
    "remove_member",
    "change_role",
    "transfer_ownership",
    "provision_device",
    "revoke_device",
    "delete_business",
  ],

  /** A consumer account as internal staff see it. */
  user_account: [
    "view",
    "open_case",
    "goodwill_credit",
    "suspend",
    "reinstate",
    "change_phone",
    "close",
    // TASKS.md 9.4.d: F12's holdback tier (0-3), staff-set only, never shown
    // to the user. risk_analyst only -- the same role that already suspends
    // and reinstates, and the one role `whoever-can-adjust-cannot-suspend`
    // keeps away from anything value-moving.
    "set_trust_tier",
  ],

  ledger_adjustment: [
    "view",
    "create",
    "approve",
    // TASKS.md 10.6.a: statement payout approval, dual-approved the same way
    // as `approve` above (ledger_adjustment.yaml's own
    // `nobody-approves-their-own-adjustment` rule covers both actions).
    "propose_payout",
    "approve_payout",
  ],

  moderation_item: ["view", "approve", "reject"],

  platform_setting: [
    "view",
    "grant_role",
    "set_feature_flag",
    "trip_kill_switch",
    // 1.2.f (F12/F23): per-region economy settings, same resource kind,
    // deliberately absent from admin's rule -- see platform_setting.yaml.
    "view_setting",
    "propose_setting",
    "approve_setting",
  ],

  /** Phase 3 placeholder. */
  charity_settlement: ["view", "view_statement"],

  /**
   * A principal's own credential and session lifecycle. YT-0540. This is
   * the one resource kind with no per-instance `id` that varies — every
   * action is always about the caller's OWN account, never another
   * principal's, so there is no `ownerId`-comparing derived role the way
   * `wallet`/`user_account` have: the caller IS the resource, and the
   * question the PDP answers is only "does a principal of this SHAPE ever
   * reach this action at all". See `policies/resource_policies/session.yaml`
   * for why `admin` appears in none of these rules — the same structural
   * boundary `policies/README.md` and `policy-drift.test.ts` already
   * enforce for `platform_setting`.
   */
  session: [
    "register",
    "create",
    "delete",
    "change_password",
    "request_password_reset",
    "confirm_password_reset",
    "request_email_verification",
    "confirm_email_verification",
    // 1.4.d: GET/PATCH /api/me. Same "caller IS the resource" shape as
    // everything else in this kind — see session.yaml's header.
    "view_profile",
    "update_profile",
    // 2.3.d: `/dev/clock`'s three actions, all on the CALLER's own account —
    // release its own pending grant, run the one existing scheduled job, or
    // shift its own pending unlock times. Added here rather than a new
    // resource kind for the exact reason `view_profile`/`update_profile`
    // were: no `:userId` in any of these routes, so there is nothing
    // narrower than "a real signed-in identity" to check. The controller
    // itself gates on `APP_ENV` (404 in production), same as `/dev/inbox`.
    "dev_clock_release_pending",
    "dev_clock_run_job",
    "dev_clock_advance_days",
  ],

  /**
   * The viewer's own sub-account data (5.4/5.5): consents, declared
   * interests, follows, saves, continue-watching, streak and
   * notifications, plus account deletion and data export. A new kind
   * rather than more `session` actions, so this module's policy file and
   * `session.yaml`'s (a different module's, this phase) never need the
   * same YAML edited by two sessions at once — the reasoning is otherwise
   * identical to `session`'s own: no route here names a `:userId`, the
   * caller IS the resource, and the PDP answers only "does a principal of
   * this SHAPE ever reach this action at all". See
   * `policies/resource_policies/me.yaml`.
   */
  me: [
    "view_consents",
    "update_consent",
    "view_interests",
    "update_interests",
    "view_follows",
    "update_follows",
    "view_saves",
    "view_continue_watching",
    "update_saves",
    "view_sessions",
    "view_streak",
    "view_notifications",
    "update_notifications",
    "delete_account",
    "export_data",
    "create_link_code",
    "view_settings",
    "update_settings",
  ],

  /**
   * TASKS.md 7.1.c: accepting a team-by-email invitation. Same "caller IS
   * the resource" shape as `session`/`me` above — the route names no
   * `:tenantId` (the invitation's own token is what names the business),
   * so there is nothing narrower than "a real signed-in identity" for the
   * PDP to check. The actual authorization is the token itself: valid,
   * unexpired and unconsumed, checked by the use-case, not the PDP — see
   * `policies/resource_policies/team_invitation.yaml`.
   */
  team_invitation: ["accept"],

  /**
   * TASKS.md 8.1: a counter device's own lifecycle actions, distinct from
   * `team`'s `provision_device`/`revoke_device` (which are a BUSINESS
   * person's actions on their roster). Neither route here names a
   * `:tenantId` the caller could claim: `pair` is a bare physical device
   * presenting a one-time code with no identity at all yet (same
   * "caller IS the resource" shape as `team_invitation.accept` — the real
   * gate is the hashed, single-use code, checked by the use-case, not the
   * PDP); `unlock` is called by an ALREADY-verified `store_device` principal
   * (`StoreDevicePrincipalResolver`), proving a PIN rather than an identity.
   */
  device: ["pair", "unlock"],

  /**
   * TASKS.md 9.1: opening the internal staff console at all. Each screen
   * inside it is still gated by its own kind (kyb_document, user_account,
   * platform_setting, ...). `admin` is absent by the admin boundary, so a
   * break-glass admin also needs a working role to use the console.
   */
  staff_console: ["view"],

  /**
   * TASKS.md 9.4.d, K13: the queue of captured-voucher disputes
   * (`checkout.dispute` where `outcome = 'queued'`, 4.7.c). List-only here —
   * resolving one and posting the merchant recovery line is 10.5, which
   * needs Phase 10. No per-item ownership to check, same "the question is
   * only whether the caller holds the right working role" shape as
   * `staff_console` itself.
   */
  // TASKS.md 10.5.b: `resolve` posts the K13 recovery line (finance only —
  // voucher_dispute.yaml's own header already named finance as "who
  // eventually posts the recovery line").
  voucher_dispute: ["view", "resolve"],

  /**
   * TASKS.md 10.5.a: the real RiskGate's manual-review queue (10.4.b,
   * `ledger.risk_flag`). Same role as user_account's suspend/reinstate
   * (risk_analyst) -- releasing or suspending a flagged account is exactly
   * that action, just reached from the queue screen instead of a user
   * search. A new kind rather than folding into `user_account`: a flag has
   * its own id and its own lifecycle (pending/released/suspended)
   * independent of which user it names, and `list` has no single user to
   * scope a `user_account.view` check to.
   */
  risk_flag: ["view", "release", "suspend"],
} as const satisfies Record<string, readonly string[]>;

/** Every resource kind the PDP answers for. */
export type ResourceKind = keyof typeof RESOURCE_ACTIONS;

/** The actions defined on one kind — a union of literals, not `string`. */
export type ActionFor<K extends ResourceKind> = (typeof RESOURCE_ACTIONS)[K][number];

export const RESOURCE_KINDS = Object.keys(RESOURCE_ACTIONS) as readonly ResourceKind[];

/**
 * A resource instance as the PDP sees it. `attr` is deliberately typed as
 * unknown-valued rather than per-kind: the authoritative per-kind shape is
 * the JSON Schema in `policies/_schemas/resource/`, which Cerbos enforces on
 * its own side. Duplicating those shapes here would create a third thing to
 * keep in sync, and the one that matters is the one the PDP validates.
 */
export interface Resource<K extends ResourceKind = ResourceKind> {
  readonly kind: K;
  readonly id: string;
  readonly attr: Readonly<Record<string, unknown>>;
}
