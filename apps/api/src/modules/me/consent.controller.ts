import { Body, Controller, Get, Inject, Post, Req } from "@nestjs/common";
import { BadRequestException } from "@nestjs/common";
import type { FastifyRequest } from "fastify";
import { z } from "zod";
import { latestPerPurpose } from "@yourtal/consent/consent-record";
import { processingPurposeSchema } from "@yourtal/consent/purpose";
import { currentPolicyVersion } from "@yourtal/consent/policy-version";
import { Authorize } from "../../shared/authz/authorize.decorator";
import { NotValueMoving } from "../../shared/idempotency/idempotent.decorator";
import { PrincipalService } from "../../shared/authz/principal.service";
import type { PrincipalResolver } from "../../shared/authz/principal-resolver";
import { CONSENT_RECORD_REPOSITORY } from "./persistence/consent-record.repository";
import type { ConsentRecordRepository } from "./persistence/consent-record.repository";
import { USER_PROFILE_REPOSITORY } from "../identity/persistence/user-profile.repository";
import type { UserProfileRepository } from "../identity/persistence/user-profile.repository";
import { requireRegion } from "./require-region";

const updateBody = z.object({
  purpose: processingPurposeSchema,
  state: z.enum(["granted", "withdrawn"]),
  source: z.enum([
    "settings_toggle",
    "onboarding",
    "contextual_prompt",
    "oidc_consent_screen",
    "import_from_sister_app",
  ]),
});

/**
 * `GET`/`POST /api/me/consents` (5.4.a) — per-purpose consent, append-only.
 * A withdrawal is a new record (never an edit), matching
 * `@yourtal/consent/consent-record`'s own doc comment; `mayUseSignalFor`
 * elsewhere is the only thing that should ever DECIDE from these, this
 * route only ever records and reads back the caller's own answers.
 */
@Controller("api/me/consents")
export class ConsentController {
  constructor(
    @Inject(PrincipalService) private readonly principals: PrincipalResolver,
    @Inject(CONSENT_RECORD_REPOSITORY) private readonly records: ConsentRecordRepository,
    @Inject(USER_PROFILE_REPOSITORY) private readonly profiles: UserProfileRepository,
  ) {}

  @Authorize({ kind: "me", action: "view_consents" })
  @NotValueMoving("A read of the caller's own consent history.")
  @Get()
  async list(@Req() request: FastifyRequest) {
    const userId = (await this.principals.resolve(request)).id;
    const all = await this.records.listForUser(userId);
    const latest = latestPerPurpose(all);
    return { consents: [...latest.values()] };
  }

  @NotValueMoving(
    "Append-only: a retried POST with the same purpose/state adds a harmless duplicate " +
      "row, and the read side (latestPerPurpose) only ever looks at the newest.",
  )
  @Authorize({ kind: "me", action: "update_consent" })
  @Post()
  async update(@Req() request: FastifyRequest, @Body() body: unknown) {
    const parsed = updateBody.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException("A consent update needs purpose, state and source.");
    }

    const principal = await this.principals.resolve(request);
    const jurisdiction = await requireRegion(this.profiles, principal.id);
    const version = currentPolicyVersion(jurisdiction);
    if (version === undefined) {
      throw new BadRequestException(`No current consent policy for jurisdiction ${jurisdiction}.`);
    }

    await this.records.append({
      userId: principal.id,
      purpose: parsed.data.purpose,
      jurisdiction,
      policyVersionId: version.id,
      state: parsed.data.state,
      recordedAt: new Date().toISOString(),
      source: parsed.data.source,
    });

    const all = await this.records.listForUser(principal.id);
    return { consents: [...latestPerPurpose(all).values()] };
  }
}
