import {
  BadRequestException,
  Controller,
  Delete,
  Get,
  Inject,
  NotFoundException,
  Param,
  Put,
  Req,
} from "@nestjs/common";
import type { FastifyRequest } from "fastify";
import { z } from "zod";
import { Authorize } from "../../shared/authz/authorize.decorator";
import { NotValueMoving } from "../../shared/idempotency/idempotent.decorator";
import { PrincipalService } from "../../shared/authz/principal.service";
import type { PrincipalResolver } from "../../shared/authz/principal-resolver";
import { FOLLOW_REPOSITORY } from "./persistence/follow.repository";
import type { FollowRepository } from "./persistence/follow.repository";
import { FOLLOWABLE_BUSINESS_READER } from "./persistence/followable-business.reader";
import type { FollowableBusinessReader } from "./persistence/followable-business.reader";
import { USER_PROFILE_REPOSITORY } from "../identity/persistence/user-profile.repository";
import type { UserProfileRepository } from "../identity/persistence/user-profile.repository";
import { requireRegion } from "./require-region";

const businessIdParam = z.uuid();

/**
 * `GET /api/me/follows`, `PUT`/`DELETE /api/me/follows/:businessId`
 * (5.4.a) — a private ranking signal only (docs/CLAUDE.md: no user-to-user
 * surface, no follower counts). F2: a follow can only ever name a business
 * in the caller's own region — the region wall holds here too, even though
 * this is not a Cerbos-scoped resource.
 */
@Controller("api/me/follows")
export class FollowsController {
  constructor(
    @Inject(PrincipalService) private readonly principals: PrincipalResolver,
    @Inject(FOLLOW_REPOSITORY) private readonly follows: FollowRepository,
    @Inject(FOLLOWABLE_BUSINESS_READER) private readonly businesses: FollowableBusinessReader,
    @Inject(USER_PROFILE_REPOSITORY) private readonly profiles: UserProfileRepository,
  ) {}

  @Authorize({ kind: "me", action: "view_follows" })
  @NotValueMoving("A read of the caller's own follow list.")
  @Get()
  async list(@Req() request: FastifyRequest) {
    const userId = (await this.principals.resolve(request)).id;
    return { follows: await this.follows.listForUser(userId) };
  }

  @NotValueMoving("Following twice ends in the same followed state as following once.")
  @Authorize({ kind: "me", action: "update_follows" })
  @Put(":businessId")
  async follow(@Req() request: FastifyRequest, @Param("businessId") businessId: string) {
    if (!businessIdParam.safeParse(businessId).success) {
      throw new BadRequestException("businessId must be a uuid.");
    }
    const principal = await this.principals.resolve(request);
    const region = await requireRegion(this.profiles, principal.id);
    const business = await this.businesses.findById(businessId);
    if (business === null) throw new NotFoundException("No such business.");
    if (business.region !== region) {
      // F2: never let a follow point across the region wall.
      throw new NotFoundException("No such business.");
    }
    await this.follows.follow(principal.id, businessId, business.region);
    return { following: true };
  }

  @NotValueMoving("Unfollowing twice ends in the same not-followed state as unfollowing once.")
  @Authorize({ kind: "me", action: "update_follows" })
  @Delete(":businessId")
  async unfollow(@Req() request: FastifyRequest, @Param("businessId") businessId: string) {
    const userId = (await this.principals.resolve(request)).id;
    await this.follows.unfollow(userId, businessId);
    return { following: false };
  }
}
