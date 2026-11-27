import { Body, Controller, Get, Inject, Post, Req } from "@nestjs/common";
import { BadRequestException, ConflictException, ForbiddenException } from "@nestjs/common";
import type { FastifyRequest } from "fastify";
import { z } from "zod";
import { GOD_GROUP_NOTICE, adultShouldBeAsked, isInGod } from "@yourtal/consent/god-group-notice";
import type { GodConsentRecord } from "@yourtal/consent/god-group-notice";
import { Authorize } from "../../shared/authz/authorize.decorator";
import { NotValueMoving } from "../../shared/idempotency/idempotent.decorator";
import { AsyncPrincipalResolver } from "../../shared/authz/async-principal-resolver";
import { GOD_CONSENT_REPOSITORY } from "../identity/persistence/god-consent.repository";
import type { GodConsentRepository } from "../identity/persistence/god-consent.repository";
import { USER_PROFILE_REPOSITORY } from "../identity/persistence/user-profile.repository";
import type { UserProfileRepository } from "../identity/persistence/user-profile.repository";
import { requireRegion } from "./require-region";

const decideBody = z.object({
  decision: z.enum(["accepted", "declined"]),
  /** The version the person was shown, so a page left open across a new version cannot accept it. */
  noticeVersion: z.string().min(1).max(32),
});

type AgeBand = "adult" | "teen";

/**
 * `GET`/`POST /api/me/god-consent` and `POST /api/me/god-consent/withdraw`
 * (god/TASKS.md 9.1.b/9.1.f): the caller's own decision on the GOD Group
 * Privacy Notice.
 *
 * An existing account is asked on its next sign-in (`ask`), with Accept and
 * Not now. Not now records `declined` and changes nothing else: the app keeps
 * working, the person stays out of GOD, and they are asked again only when the
 * notice version changes. A teen never decides here: their guardian does, on
 * the guardian page. Anyone, teen included, may ask to stop through the
 * request form (`withdraw`, founder Q4).
 *
 * Same `me` actions as `/api/me/consents` (`view_consents`/`update_consent`):
 * it is the same kind of answer about the caller's own account.
 */
@Controller("api/me/god-consent")
export class GodConsentController {
  constructor(
    // The async resolver, for `ageBand` (see ConsentController's own note).
    private readonly principals: AsyncPrincipalResolver,
    @Inject(GOD_CONSENT_REPOSITORY) private readonly consents: GodConsentRepository,
    @Inject(USER_PROFILE_REPOSITORY) private readonly profiles: UserProfileRepository,
  ) {}

  @Authorize({ kind: "me", action: "view_consents" })
  @NotValueMoving("A read of the caller's own GOD notice decision.")
  @Get()
  async status(@Req() request: FastifyRequest) {
    const principal = await this.principals.resolve(request);
    return this.view(principal.id, ageBandOf(principal.attr.ageBand));
  }

  @NotValueMoving(
    "Append-only: a retried decision adds a duplicate row, and only the newest one counts.",
  )
  @Authorize({ kind: "me", action: "update_consent" })
  @Post()
  async decide(@Req() request: FastifyRequest, @Body() body: unknown) {
    const parsed = decideBody.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException("A decision needs decision and noticeVersion.");
    }
    const principal = await this.principals.resolve(request);
    const ageBand = ageBandOf(principal.attr.ageBand);
    if (ageBand === "teen") {
      throw new ForbiddenException({
        code: "teen_consent_not_allowed",
        message: "A parent or guardian decides this for a teen account.",
      });
    }
    if (parsed.data.noticeVersion !== GOD_GROUP_NOTICE.version) {
      throw new ConflictException({
        code: "notice_changed",
        message: "The notice has changed since this page was opened.",
      });
    }

    const region = await requireRegion(this.profiles, principal.id);
    await this.consents.append(
      {
        userId: principal.id,
        region,
        decision: parsed.data.decision,
        method: "next_sign_in",
        track: "adult",
      },
      new Date(),
    );
    return this.view(principal.id, ageBand);
  }

  @NotValueMoving(
    "Append-only: a retried withdrawal adds a second withdrawn row; the outcome is the same.",
  )
  @Authorize({ kind: "me", action: "update_consent" })
  @Post("withdraw")
  async withdraw(@Req() request: FastifyRequest) {
    const principal = await this.principals.resolve(request);
    const ageBand = ageBandOf(principal.attr.ageBand);
    const region = await requireRegion(this.profiles, principal.id);
    await this.consents.append(
      { userId: principal.id, region, decision: "withdrawn", method: "request", track: ageBand },
      new Date(),
    );
    return this.view(principal.id, ageBand);
  }

  private async view(userId: string, ageBand: AgeBand) {
    const current = await this.consents.current(userId);
    return {
      notice: GOD_GROUP_NOTICE,
      ageBand,
      current: current === null ? null : publicView(current),
      ask: adultShouldBeAsked(current, ageBand),
      inGod: isInGod(current, ageBand),
    };
  }
}

/** Unknown age reads as teen: the stricter answer, never one that lets someone decide for themselves wrongly. */
function ageBandOf(value: unknown): AgeBand {
  return value === "adult" ? "adult" : "teen";
}

/** Never the user id or a guardian's id: the caller knows who they are. */
function publicView(record: GodConsentRecord) {
  return {
    noticeVersion: record.noticeVersion,
    decision: record.decision,
    method: record.method,
    track: record.track,
    decidedAt: record.recordedAt,
  };
}
