import { Body, Controller, Get, Inject, Param, Post } from "@nestjs/common";
import { PublicRoute } from "../../shared/authz/authorize.decorator";
import {
  GUARDIAN_CONSENT_APPROVE_RATE_LIMIT,
  GUARDIAN_CONSENT_REVOKE_RATE_LIMIT,
  GUARDIAN_CONSENT_VIEW_RATE_LIMIT,
  RateLimit,
} from "../../shared/rate-limit/rate-limit.decorator";
import { Idempotent } from "../../shared/idempotency/idempotent.decorator";
import type { AppDb } from "../../shared/persistence/drizzle-client";
import { LEDGER_INTERNAL_CLIENT } from "../../shared/ledger-client/ledger-internal-client";
import type { LedgerInternalClient } from "../../shared/ledger-client/ledger-internal-client";
import { IDENTITY_DB } from "./persistence/identity-db.token";
import { GUARDIAN_CONSENT_REPOSITORY } from "./persistence/guardian-consent.repository";
import type { GuardianConsentRepository } from "./persistence/guardian-consent.repository";
import { USER_PROFILE_REPOSITORY } from "./persistence/user-profile.repository";
import type { UserProfileRepository } from "./persistence/user-profile.repository";
import { ApproveGuardianConsentDto } from "./dto/approve-guardian-consent.schema";
import { mapGuardianConsentErrorToHttpException } from "./to-http-exception";
import { getGuardianConsent } from "./use-cases/get-guardian-consent.use-case";
import { approveGuardianConsent } from "./use-cases/approve-guardian-consent.use-case";
import { revokeGuardianConsent } from "./use-cases/revoke-guardian-consent.use-case";
import {
  APPROVE_GUARDIAN_CONSENT_RETENTION_MS,
  REVOKE_GUARDIAN_CONSENT_RETENTION_MS,
} from "./guardian-consent-retention";

/**
 * `GET/POST /api/guardian/:token[/approve|/revoke]` (TASKS.md 12.1.a). No
 * `:tenantId` and no session — same reasoning `AuthController`'s own header
 * gives for `/api/auth/*`: there is no guardian account, and the hashed
 * token IS the credential, the same shape `DevicePairingController`'s own
 * header documents for a counter device's pairing code. `@PublicRoute`
 * everywhere here, backed by nothing more than that token — no Cerbos
 * question is asked for any of these three, because there is no principal
 * to ask one about.
 *
 * The web page these routes serve (`/guardian/[token]`) is 12.2.c, built by
 * whoever owns `apps/web` — not this ticket. This controller is the whole
 * of that page's backend contract (`@yourtal/contracts/identity/guardian`).
 */
@Controller("api/guardian")
export class GuardianConsentController {
  constructor(
    @Inject(IDENTITY_DB) private readonly db: AppDb,
    @Inject(GUARDIAN_CONSENT_REPOSITORY) private readonly consents: GuardianConsentRepository,
    @Inject(USER_PROFILE_REPOSITORY) private readonly profiles: UserProfileRepository,
    @Inject(LEDGER_INTERNAL_CLIENT) private readonly ledger: LedgerInternalClient,
  ) {}

  @RateLimit(GUARDIAN_CONSENT_VIEW_RATE_LIMIT)
  @PublicRoute("no principal exists yet; the hashed guardian token is the real credential")
  @Get(":token")
  async view(@Param("token") token: string) {
    const result = await getGuardianConsent(this.consents, this.profiles, token);
    if (result.isErr()) throw mapGuardianConsentErrorToHttpException(result.error);
    return result.value;
  }

  @Idempotent({ retentionMs: APPROVE_GUARDIAN_CONSENT_RETENTION_MS })
  @RateLimit(GUARDIAN_CONSENT_APPROVE_RATE_LIMIT)
  @PublicRoute("no principal exists yet; the hashed guardian token is the real credential")
  @Post(":token/approve")
  async approve(@Param("token") token: string, @Body() _body: ApproveGuardianConsentDto) {
    // `_body.confirmAdult` is already proven `true` by the DTO's own schema
    // (a literal, not a domain rule) — nothing left to branch on here.
    const result = await approveGuardianConsent(
      this.db,
      this.consents,
      this.profiles,
      token,
      new Date(),
    );
    if (result.isErr()) throw mapGuardianConsentErrorToHttpException(result.error);
    return result.value;
  }

  @Idempotent({ retentionMs: REVOKE_GUARDIAN_CONSENT_RETENTION_MS })
  @RateLimit(GUARDIAN_CONSENT_REVOKE_RATE_LIMIT)
  @PublicRoute("no principal exists yet; the hashed guardian token is the real credential")
  @Post(":token/revoke")
  async revoke(@Param("token") token: string) {
    const result = await revokeGuardianConsent(
      this.db,
      this.consents,
      this.profiles,
      this.ledger,
      token,
      new Date(),
    );
    if (result.isErr()) throw mapGuardianConsentErrorToHttpException(result.error);
    return result.value;
  }
}
