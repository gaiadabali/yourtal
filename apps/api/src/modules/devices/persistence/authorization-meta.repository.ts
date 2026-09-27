export interface AuthorizationMeta {
  readonly authorizationId: string;
  readonly deviceId: string;
  readonly businessId: string;
  readonly locationId: string;
  readonly orderRef: string;
  readonly orderTotalMinor: number;
}

export interface AuthorizationMetaRepository {
  save(meta: AuthorizationMeta): Promise<void>;
  /** Consumes it: a capture reads this once and the row is gone, matching the hold it shadows being one-shot too. */
  takeByAuthorizationId(authorizationId: string): Promise<AuthorizationMeta | null>;
}

export const AUTHORIZATION_META_REPOSITORY = Symbol("AUTHORIZATION_META_REPOSITORY");
