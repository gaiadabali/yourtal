import { Body, Controller, Delete, Get, Inject, Param, Post, Req } from "@nestjs/common";
import type { FastifyRequest } from "fastify";
import { Authorize } from "../../shared/authz/authorize.decorator";
import { AsyncPrincipalResolver } from "../../shared/authz/async-principal-resolver";
import { Idempotent, NotValueMoving } from "../../shared/idempotency/idempotent.decorator";
import { PROVISION_DEVICE_RETENTION_MS } from "./retention";
import { WEBHOOK_SECRET_ENCRYPTION_KEY } from "./developers/webhook-secret-encryption-key";
import { VOUCHER_INTERNAL_CLIENT } from "../../shared/voucher-client/voucher-internal-client";
import type { VoucherInternalClient } from "../../shared/voucher-client/voucher-internal-client";
import { DEVELOPER_CREDENTIAL_REPOSITORY } from "./developers/persistence/developer-credential.repository";
import type { DeveloperCredentialRepository } from "./developers/persistence/developer-credential.repository";
import { WEBHOOK_SUBSCRIPTION_REPOSITORY } from "./developers/persistence/webhook-subscription.repository";
import type { WebhookSubscriptionRepository } from "./developers/persistence/webhook-subscription.repository";
import {
  IssueDeveloperCredentialDto,
  RegisterWebhookDto,
} from "./developers/dto/developers.schema";
import { issueCredential } from "./developers/use-cases/issue-credential.use-case";
import { rotateCredential } from "./developers/use-cases/rotate-credential.use-case";
import { revokeCredential } from "./developers/use-cases/revoke-credential.use-case";
import { listCredentials } from "./developers/use-cases/list-credentials.use-case";
import { registerWebhook } from "./developers/use-cases/register-webhook.use-case";
import { mapDevelopersErrorToHttpException } from "./developers/to-http-exception";

/** TASKS.md 8.3.a/8.3.c: Studio -> Developers — merchant HMAC credentials and the webhook delivery URL. */
@Controller("api/:tenantId/studio/developers")
export class StudioDevelopersController {
  constructor(
    private readonly principals: AsyncPrincipalResolver,
    @Inject(VOUCHER_INTERNAL_CLIENT) private readonly vouchers: VoucherInternalClient,
    @Inject(DEVELOPER_CREDENTIAL_REPOSITORY)
    private readonly credentials: DeveloperCredentialRepository,
    @Inject(WEBHOOK_SUBSCRIPTION_REPOSITORY)
    private readonly webhooks: WebhookSubscriptionRepository,
    @Inject(WEBHOOK_SECRET_ENCRYPTION_KEY) private readonly encryptionKey: string,
  ) {}

  @Authorize({ kind: "redemption", action: "view_credential" })
  @Get("credentials")
  async list(@Param("tenantId") tenantId: string) {
    const result = await listCredentials(this.credentials, tenantId);
    if (result.isErr()) throw mapDevelopersErrorToHttpException(result.error);
    return result.value;
  }

  @Idempotent({ retentionMs: PROVISION_DEVICE_RETENTION_MS })
  @Authorize({ kind: "redemption", action: "view_credential" })
  @Post("credentials")
  async issue(
    @Param("tenantId") tenantId: string,
    @Body() body: IssueDeveloperCredentialDto,
    @Req() request: FastifyRequest,
  ) {
    const principal = await this.principals.resolve(request);
    const result = await issueCredential(this.vouchers, this.credentials, {
      businessId: tenantId,
      label: body.label,
      sandbox: body.sandbox,
      issuedBy: principal.id,
    });
    if (result.isErr()) throw mapDevelopersErrorToHttpException(result.error);
    return result.value;
  }

  // Rotation replaces the secret every retry would also replace — never
  // value-moving, but a retry must not mint a SECOND new secret silently
  // superseding the one just shown, so it is idempotent, not exempt.
  @Idempotent({ retentionMs: PROVISION_DEVICE_RETENTION_MS })
  @Authorize({ kind: "redemption", action: "rotate_credential" })
  @Post("credentials/:credentialId/rotate")
  async rotate(
    @Param("tenantId") tenantId: string,
    @Param("credentialId") credentialId: string,
    @Req() request: FastifyRequest,
  ) {
    const principal = await this.principals.resolve(request);
    const result = await rotateCredential(
      this.vouchers,
      this.credentials,
      tenantId,
      credentialId,
      principal.id,
    );
    if (result.isErr()) throw mapDevelopersErrorToHttpException(result.error);
    return result.value;
  }

  @NotValueMoving("revocation only ever moves a credential toward 'revoked'; retrying is a no-op")
  @Authorize({ kind: "redemption", action: "revoke_credential" })
  @Delete("credentials/:credentialId")
  async revoke(
    @Param("tenantId") tenantId: string,
    @Param("credentialId") credentialId: string,
    @Req() request: FastifyRequest,
  ) {
    const principal = await this.principals.resolve(request);
    const result = await revokeCredential(
      this.vouchers,
      this.credentials,
      tenantId,
      credentialId,
      principal.id,
    );
    if (result.isErr()) throw mapDevelopersErrorToHttpException(result.error);
    return { revoked: true as const };
  }

  // (requested by B, 8.3.a): the secret is shown once, at registration
  // (register-webhook.use-case.ts's own doc comment) — this never returns
  // it, only what the page needs to show a registered URL on load.
  @Authorize({ kind: "redemption", action: "view_credential" })
  @Get("webhooks")
  async currentWebhook(@Param("tenantId") tenantId: string) {
    const row = await this.webhooks.findByBusinessId(tenantId);
    if (row === null) return null;
    return {
      businessId: row.businessId,
      url: row.url,
      secretIssuedAt: row.createdAt.toISOString(),
    };
  }

  @Idempotent({ retentionMs: PROVISION_DEVICE_RETENTION_MS })
  @Authorize({ kind: "redemption", action: "rotate_credential" })
  @Post("webhooks")
  async registerWebhookRoute(
    @Param("tenantId") tenantId: string,
    @Body() body: RegisterWebhookDto,
  ) {
    const result = await registerWebhook(this.webhooks, this.encryptionKey, tenantId, body.url);
    if (result.isErr()) throw mapDevelopersErrorToHttpException(result.error);
    return result.value;
  }
}
