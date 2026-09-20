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
  business: ["view", "edit", "create"],

  /**
   * KYB onboarding documents. Submitted and read by the business
   * (owner/admin); reviewed by `ops` (docs/17 section 5). A business can
   * never approve or reject its own submission -- see the DENY rule in
   * `kyb_document.yaml`.
   */
  kyb_document: ["view", "submit", "approve", "reject"],

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
  ],

  /** Bulk voucher issuance, two-person approved. */
  voucher_batch: ["view", "request_issuance", "approve_issuance", "void"],

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
  ],

  report: ["view", "export"],

  billing: ["view", "view_statement", "purchase_points", "raise_dispute", "update_payment_method"],

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
  ],

  ledger_adjustment: ["view", "create", "approve"],

  moderation_item: ["view", "approve", "reject"],

  platform_setting: ["view", "grant_role", "set_feature_flag", "trip_kill_switch"],

  /** Phase 3 placeholder. */
  charity_settlement: ["view", "view_statement"],
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
