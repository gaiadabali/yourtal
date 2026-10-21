export interface PersistenceFailedError {
  readonly type: "persistence_failed";
  readonly cause: string;
}

export interface InvalidLinkCodeError {
  readonly type: "invalid_link_code";
}

/** 14.3.b: no link with this id for this partner. */
export interface UnknownLinkError {
  readonly type: "unknown_link";
}

/** 14.3.b: the user unlinked the app, so the link earns nothing. */
export interface LinkRevokedError {
  readonly type: "link_revoked";
}

/** F101/F105: a teen account cannot link a partner app. */
export interface TeenNotAllowedError {
  readonly type: "teen_not_allowed";
}

export type PartnerLinkError =
  | PersistenceFailedError
  | InvalidLinkCodeError
  | UnknownLinkError
  | LinkRevokedError
  | TeenNotAllowedError;

/** F126: the account has not passed the identity check (a verified email and a passkey), so it earns nothing yet. */
export interface IdentityCheckRequiredError {
  readonly type: "identity_check_required";
}

export type PartnerActionError = PartnerLinkError | IdentityCheckRequiredError;
