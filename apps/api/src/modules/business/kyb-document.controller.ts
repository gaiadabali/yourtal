import { Body, Controller, Get, Inject, Param, Post } from "@nestjs/common";
import { PrincipalService } from "../../shared/authz/principal.service";
import { SubmitKybDocumentDto } from "./dto/submit-kyb-document.schema";
import { BUSINESS_ACCOUNT_REPOSITORY } from "./persistence/business-account.repository";
import type { BusinessAccountRepository } from "./persistence/business-account.repository";
import { KYB_DOCUMENT_REPOSITORY } from "./persistence/kyb-document.repository";
import type { KybDocumentRepository } from "./persistence/kyb-document.repository";
import { mapBusinessErrorToHttpException } from "./to-http-exception";
import { listKybDocuments } from "./use-cases/list-kyb-documents.use-case";
import { submitKybDocument } from "./use-cases/submit-kyb-document.use-case";
import { Idempotent } from "../../shared/idempotency/idempotent.decorator";
import { ONBOARDING_RETENTION_MS } from "../../shared/idempotency/retention";
import { Authorize } from "../../shared/authz/authorize.decorator";

/**
 * `kyb_document` (YT-0507): a business submits and reads its own onboarding
 * documents (owner/admin, per `policies/resource_policies/kyb_document.yaml`);
 * review is `ops`'s job (docs/17 section 5), never the business's own, and
 * that separation is enforced by an explicit DENY in the policy, not merely
 * by omission.
 */
@Controller("api/:tenantId/business/kyb-documents")
export class KybDocumentController {
  constructor(
    private readonly principals: PrincipalService,
    @Inject(BUSINESS_ACCOUNT_REPOSITORY) private readonly businesses: BusinessAccountRepository,
    @Inject(KYB_DOCUMENT_REPOSITORY) private readonly kybDocuments: KybDocumentRepository,
  ) {}

  @Authorize({ kind: "kyb_document", action: "view" })
  @Get()
  async list(@Param("tenantId") tenantId: string) {
    const result = await listKybDocuments(this.businesses, this.kybDocuments, tenantId);
    if (result.isErr()) {
      throw mapBusinessErrorToHttpException(result.error);
    }
    return result.value;
  }

  // Duplicate submissions of regulated paperwork put an ops reviewer in
  // front of the same document twice and make "which one did we verify"
  // a real question at exactly the wrong moment.
  @Idempotent({ retentionMs: ONBOARDING_RETENTION_MS })
  @Authorize({ kind: "kyb_document", action: "submit" })
  @Post()
  async submit(@Param("tenantId") tenantId: string, @Body() body: SubmitKybDocumentDto) {
    const result = await submitKybDocument(this.businesses, this.kybDocuments, {
      businessId: tenantId,
      documentType: body.documentType,
      storageRef: body.storageRef,
      expiresAt: body.expiresAt,
    });
    if (result.isErr()) {
      throw mapBusinessErrorToHttpException(result.error);
    }
    return result.value;
  }
}
