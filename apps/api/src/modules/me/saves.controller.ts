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
import { CAMPAIGN_REPOSITORY } from "../campaign/persistence/campaign.repository";
import type { CampaignRepository } from "../campaign/persistence/campaign.repository";
import { SAVE_REPOSITORY } from "./persistence/save.repository";
import type { SaveRepository } from "./persistence/save.repository";

const campaignIdParam = z.uuid();

/**
 * `GET /api/me/saves`, `PUT`/`DELETE /api/me/saves/:campaignId` (5.4.a) —
 * a private "watch later" list.
 */
@Controller("api/me/saves")
export class SavesController {
  constructor(
    @Inject(PrincipalService) private readonly principals: PrincipalResolver,
    @Inject(SAVE_REPOSITORY) private readonly saves: SaveRepository,
    @Inject(CAMPAIGN_REPOSITORY) private readonly campaigns: CampaignRepository,
  ) {}

  @Authorize({ kind: "me", action: "view_saves" })
  @NotValueMoving("A read of the caller's own saved list.")
  @Get()
  async list(@Req() request: FastifyRequest) {
    const userId = (await this.principals.resolve(request)).id;
    return { campaignIds: await this.saves.listForUser(userId) };
  }

  @NotValueMoving("Saving twice ends in the same saved state as saving once.")
  @Authorize({ kind: "me", action: "update_saves" })
  @Put(":campaignId")
  async save(@Req() request: FastifyRequest, @Param("campaignId") campaignId: string) {
    if (!campaignIdParam.safeParse(campaignId).success) {
      throw new BadRequestException("campaignId must be a uuid.");
    }
    const campaign = await this.campaigns.findVisibleById(campaignId);
    if (campaign === null) throw new NotFoundException("No such campaign.");
    const userId = (await this.principals.resolve(request)).id;
    await this.saves.save(userId, campaignId);
    return { saved: true };
  }

  @NotValueMoving("Unsaving twice ends in the same not-saved state as unsaving once.")
  @Authorize({ kind: "me", action: "update_saves" })
  @Delete(":campaignId")
  async unsave(@Req() request: FastifyRequest, @Param("campaignId") campaignId: string) {
    const userId = (await this.principals.resolve(request)).id;
    await this.saves.unsave(userId, campaignId);
    return { saved: false };
  }
}
