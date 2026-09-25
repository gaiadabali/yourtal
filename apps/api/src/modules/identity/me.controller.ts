import { Body, Controller, Get, Inject, Patch, Req } from "@nestjs/common";
import type { FastifyRequest } from "fastify";
import { Authorize } from "../../shared/authz/authorize.decorator";
import { NotValueMoving } from "../../shared/idempotency/idempotent.decorator";
import { PrincipalService } from "../../shared/authz/principal.service";
import {
  BUSINESS_MEMBERSHIP_READER,
  type BusinessMembershipReader,
} from "./persistence/business-membership-reader";
import { USER_PROFILE_REPOSITORY } from "./persistence/user-profile.repository";
import type { UserProfileRepository } from "./persistence/user-profile.repository";
import { UpdateMeDto } from "./dto/update-me.schema";
import { mapMeErrorToHttpException } from "./to-http-exception";
import { getMe } from "./use-cases/get-me.use-case";
import { updateMe } from "./use-cases/update-me.use-case";

/**
 * `GET`/`PATCH /api/me` (1.4.d) — root routes only. B's `me` module owns the
 * sub-routes (e.g. interests, notifications) and C's `business` module owns
 * `/api/me/businesses`'s own detail; this controller only ever returns a
 * summary of each.
 *
 * `session` kind, not a new resource kind: there is no `:userId` in either
 * route, so the PDP question is the same coarse "does a principal of this
 * SHAPE reach this action at all" `policies/resource_policies/session.yaml`
 * already answers for register/login/logout — see that file's header.
 */
@Controller("api/me")
export class MeController {
  constructor(
    private readonly principals: PrincipalService,
    @Inject(USER_PROFILE_REPOSITORY) private readonly profiles: UserProfileRepository,
    @Inject(BUSINESS_MEMBERSHIP_READER) private readonly businessMemberships: BusinessMembershipReader,
  ) {}

  @Authorize({ kind: "session", action: "view_profile" })
  @Get()
  async getMe(@Req() request: FastifyRequest) {
    const userId = this.principals.resolve(request).id;
    const result = await getMe(this.profiles, this.businessMemberships, userId, new Date());
    if (result.isErr()) throw mapMeErrorToHttpException(result.error);
    return result.value;
  }

  @NotValueMoving(
    "A PATCH replacing display name/locale with the same request twice ends in the same " +
      "state either time — there is nothing here a retry could double-apply.",
  )
  @Authorize({ kind: "session", action: "update_profile" })
  @Patch()
  async patchMe(@Req() request: FastifyRequest, @Body() body: UpdateMeDto) {
    const userId = this.principals.resolve(request).id;
    const result = await updateMe(this.profiles, userId, {
      // `exactOptionalPropertyTypes`: an explicit `displayName: undefined`
      // is not the same as omitting the key, so each is only ever included
      // when the caller actually sent it.
      ...(body.displayName === undefined ? {} : { displayName: body.displayName }),
      ...(body.displayLocale === undefined ? {} : { displayLocale: body.displayLocale }),
    });
    if (result.isErr()) throw mapMeErrorToHttpException(result.error);

    const refreshed = await getMe(this.profiles, this.businessMemberships, userId, new Date());
    if (refreshed.isErr()) throw mapMeErrorToHttpException(refreshed.error);
    return refreshed.value;
  }
}
