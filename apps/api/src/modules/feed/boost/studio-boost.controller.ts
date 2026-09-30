import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Inject,
  NotFoundException,
  Param,
  Put,
} from "@nestjs/common";
import { sql } from "drizzle-orm";
import { setBoostRequestSchema } from "@yourtal/contracts/studio/boost";
import type { BoostView } from "@yourtal/contracts/studio/boost";
import type { Region } from "@yourtal/contracts/region";
import { toMinorUnits } from "@yourtal/contracts/money";
import { Authorize } from "../../../shared/authz/authorize.decorator";
import { NotValueMoving } from "../../../shared/idempotency/idempotent.decorator";
import type { AppDb } from "../../../shared/persistence/drizzle-client";
import { REGION_SETTINGS_READER } from "../../../shared/settings/region-settings-reader";
import type { RegionSettingsReader } from "../../../shared/settings/region-settings-reader";
import { BOOST_DB, BOOST_REPOSITORY } from "./boost.tokens";
import type { BoostRepository } from "./boost.repository";
import { spendMinorOf } from "./boost.repository";
import { reserveCpmFor } from "./boost-reserve";

interface OwnedCampaign {
  readonly region: Region;
  readonly currency: "AUD" | "IDR";
  readonly lifecycleState: string;
}

/**
 * 13.23.a/c/d: a business's Boost setting on a live campaign, its delivery
 * report, and the cash charges that billed it. Setting a boost spends the
 * business's cash, so it takes the billing editor's permission; reading it
 * takes billing view. The currency is always the business's own.
 */
@Controller("api/:tenantId/studio")
export class StudioBoostController {
  constructor(
    @Inject(BOOST_REPOSITORY) private readonly boosts: BoostRepository,
    @Inject(BOOST_DB) private readonly db: AppDb,
    @Inject(REGION_SETTINGS_READER) private readonly settings: RegionSettingsReader,
  ) {}

  @Authorize({ kind: "billing", action: "view" })
  @Get("campaigns/:campaignId/boost")
  async get(@Param("tenantId") tenantId: string, @Param("campaignId") campaignId: string) {
    const campaign = await this.owned(tenantId, campaignId);
    return this.view(campaignId, campaign);
  }

  @Authorize({ kind: "billing", action: "purchase_points" })
  @NotValueMoving(
    "A full replacement of the setting; nothing is charged here. Charges happen once per " +
      "closed day in the boost-settle job, keyed on (campaign, day).",
  )
  @Put("campaigns/:campaignId/boost")
  async set(
    @Param("tenantId") tenantId: string,
    @Param("campaignId") campaignId: string,
    @Body() body: unknown,
  ) {
    const parsed = setBoostRequestSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException({ code: "invalid_boost", message: parsed.error.message });
    }
    const campaign = await this.owned(tenantId, campaignId);
    if (campaign.lifecycleState !== "live") {
      throw new BadRequestException({
        code: "campaign_not_live",
        message: "Only a live campaign can be boosted.",
      });
    }
    const reserve = await reserveCpmFor(this.settings, campaign.region);
    if (parsed.data.maxBidCpmMinor < reserve) {
      throw new BadRequestException({
        code: "bid_below_reserve",
        message: `The maximum bid must be at least the reserve of ${String(reserve)}.`,
      });
    }
    await this.boosts.upsert({
      campaignId,
      businessId: tenantId,
      region: campaign.region,
      currency: campaign.currency,
      ...parsed.data,
    });
    return this.view(campaignId, campaign);
  }

  @Authorize({ kind: "billing", action: "view_statement" })
  @Get("billing/boost-charges")
  async charges(@Param("tenantId") tenantId: string) {
    return { charges: await this.boosts.charges(tenantId) };
  }

  /** 404 unless the campaign is this business's own, so another tenant's id reveals nothing. */
  private async owned(tenantId: string, campaignId: string): Promise<OwnedCampaign> {
    const { rows } = await this.db.execute(sql`
      SELECT c.region, c.lifecycle_state, b.currency
        FROM campaign.campaigns c JOIN business.business_accounts b ON b.id = c.business_id
       WHERE c.id = ${campaignId} AND c.business_id = ${tenantId}`);
    const row = rows[0];
    if (row === undefined) throw new NotFoundException("No such campaign.");
    return {
      region: row["region"] as Region,
      currency: row["currency"] as "AUD" | "IDR",
      lifecycleState: String(row["lifecycle_state"]),
    };
  }

  private async view(campaignId: string, campaign: OwnedCampaign): Promise<BoostView> {
    const [setting, totals, reserve] = await Promise.all([
      this.boosts.find(campaignId),
      this.boosts.totals(campaignId),
      reserveCpmFor(this.settings, campaign.region),
    ]);
    const impressions = totals.days.reduce((sum, day) => sum + day.impressions, 0);
    return {
      campaignId,
      currency: campaign.currency,
      setting:
        setting === null
          ? null
          : {
              dailyBudgetMinor: toMinorUnits(setting.dailyBudgetMinor),
              maxBidCpmMinor: toMinorUnits(setting.maxBidCpmMinor),
              startsAt: setting.startsAt,
              endsAt: setting.endsAt,
              state: setting.state,
            },
      reserveCpmMinor: reserve,
      impressions,
      spendMinor: totals.days.reduce((sum, day) => sum + spendMinorOf(day.spentMilli), 0),
      averageCpmMinor: impressions === 0 ? null : Math.round(totals.priceSum / impressions),
      days: totals.days.map((day) => ({
        day: day.day,
        impressions: day.impressions,
        spendMinor: spendMinorOf(day.spentMilli),
      })),
    };
  }
}
