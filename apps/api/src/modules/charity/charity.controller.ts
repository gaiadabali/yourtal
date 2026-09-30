import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Inject,
  NotFoundException,
  Param,
  Post,
  Query,
  Req,
  UnprocessableEntityException,
} from "@nestjs/common";
import type { FastifyRequest } from "fastify";
import { charityApplicationRequestSchema } from "@yourtal/contracts/charity";
import type { CharityConsole } from "@yourtal/contracts/charity";
import { regionSchema } from "@yourtal/contracts/region";
import { Authorize, PublicRoute } from "../../shared/authz/authorize.decorator";
import { AsyncPrincipalResolver } from "../../shared/authz/async-principal-resolver";
import { Idempotent, NotValueMoving } from "../../shared/idempotency/idempotent.decorator";
import { ONBOARDING_RETENTION_MS } from "../../shared/idempotency/retention";
import { resolveCatalogueScope } from "../store/catalogue-scope";
import { CHARITY_DB, CharityRepository } from "./charity.repository";
import { simulatedCharityKyb } from "./simulated-kyb";

const bodyRegion = (request: FastifyRequest) => {
  const region = (request.body as { region?: unknown } | undefined)?.region;
  return region === "AU" || region === "ID" ? { region } : {};
};

/**
 * 13.21.a/b/c: a foundation applies, viewers browse approved charities in
 * their own region, and a charity's members read its console. Proceeds are
 * paid to the charity's own account at the provider; nothing here holds or
 * shows a balance (red line 8).
 */
@Controller("api")
export class CharityController {
  constructor(
    @Inject(CHARITY_DB) private readonly charities: CharityRepository,
    private readonly principals: AsyncPrincipalResolver,
  ) {}

  @Authorize({ kind: "charity", action: "apply", idFrom: () => "new", attrsFrom: bodyRegion })
  @Idempotent({ retentionMs: ONBOARDING_RETENTION_MS })
  @Post("charities/applications")
  async apply(@Body() body: unknown, @Req() request: FastifyRequest) {
    const parsed = charityApplicationRequestSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException({ code: "invalid_application", message: parsed.error.message });
    }
    const principal = await this.principals.resolve(request);
    const kyb = simulatedCharityKyb(parsed.data);
    if (!kyb.ok) {
      throw new UnprocessableEntityException({ code: "kyb_failed", reason: kyb.reason });
    }
    return this.charities.create(parsed.data, principal.id, kyb);
  }

  @PublicRoute(
    "The registry is public browse like the store: approved charities only, walled to the " +
      "caller's own region (signed in) or the stated one (anonymous), by catalogue-scope.ts.",
  )
  @NotValueMoving("A read.")
  @Get("charities")
  async list(@Query("region") regionParam: string | undefined, @Req() request: FastifyRequest) {
    const region = await this.regionFor(regionParam, request);
    return { charities: region === null ? [] : await this.charities.listApproved(region) };
  }

  @PublicRoute("One approved charity from the same public, region-walled registry.")
  @NotValueMoving("A read.")
  @Get("charities/:charityId")
  async get(
    @Param("charityId") charityId: string,
    @Query("region") regionParam: string | undefined,
    @Req() request: FastifyRequest,
  ) {
    const region = await this.regionFor(regionParam, request);
    const charity = region === null ? null : await this.charities.findApproved(charityId, region);
    if (charity === null) throw new NotFoundException("No such charity.");
    return charity;
  }

  @Authorize({ kind: "charity", action: "list_mine", idFrom: () => "mine" })
  @NotValueMoving("A read.")
  @Get("me/charities")
  async mine(@Req() request: FastifyRequest) {
    const principal = await this.principals.resolve(request);
    return { charities: await this.charities.listMine(principal.id) };
  }

  @Authorize({ kind: "charity", action: "view_console" })
  @NotValueMoving("A read.")
  @Get("charities/:charityId/console")
  async console(@Param("charityId") charityId: string): Promise<CharityConsole> {
    const charity = await this.charities.findDetail(charityId);
    if (charity === null) throw new NotFoundException("No such charity.");
    // Proceeds arrive with 13.22's auctions, captured straight to the charity.
    return { charity, proceeds: [], statements: [] };
  }

  private async regionFor(regionParam: string | undefined, request: FastifyRequest) {
    const parsed = regionParam === undefined ? undefined : regionSchema.safeParse(regionParam);
    if (parsed !== undefined && !parsed.success) {
      throw new BadRequestException({ code: "invalid_region", message: "unknown region" });
    }
    const scope = resolveCatalogueScope(await this.principals.resolve(request), parsed?.data);
    if (scope.kind === "anonymous_region_required") {
      throw new BadRequestException({
        code: "region_required",
        message: "an anonymous request must state a region query param",
      });
    }
    return scope.kind === "region_mismatch" ? null : scope.region;
  }
}
