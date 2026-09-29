import { BadRequestException, Body, Controller, Get, Inject, Put, Req } from "@nestjs/common";
import type { FastifyRequest } from "fastify";
import { z } from "zod";
import { isKnownInterestNode, isTeenInterestNode } from "@yourtal/contracts/interest/taxonomy";
import { Authorize } from "../../shared/authz/authorize.decorator";
import { NotValueMoving } from "../../shared/idempotency/idempotent.decorator";
import { AsyncPrincipalResolver } from "../../shared/authz/async-principal-resolver";
import { INTEREST_REPOSITORY } from "./persistence/interest.repository";
import type { InterestRepository } from "./persistence/interest.repository";

const replaceBody = z.object({ nodeIds: z.array(z.string().min(1)).max(50) });

/**
 * `GET`/`PUT /api/me/interests` (5.4.a) — declared interests only. Every
 * node id is checked against `INTEREST_TAXONOMY`, whose own constructor
 * (`taxonomy.ts`) already refuses a sensitive node at module load — this
 * route cannot accept one that exists, because none does.
 *
 * 12.2.a: a teen account may declare only `TEEN_INTEREST_NODE_IDS` (games,
 * books, school supplies, sportswear, streaming, cinema) — the UI picker
 * (`me-interest-catalogue.ts`) already offers only these to a teen, but the
 * server refuses the wider set regardless of what a caller sends, the same
 * "cosmetic gating is never the boundary" rule every audience wall in this
 * codebase follows. `AsyncPrincipalResolver`, not the synchronous
 * `PrincipalService`, because `ageBand` is one of the attributes only the
 * async, profile-reading resolver actually populates (see its own doc
 * comment) — the sync one's `ageBand` is permanently absent.
 */
@Controller("api/me/interests")
export class InterestsController {
  constructor(
    private readonly principals: AsyncPrincipalResolver,
    @Inject(INTEREST_REPOSITORY) private readonly interests: InterestRepository,
  ) {}

  @Authorize({ kind: "me", action: "view_interests" })
  @NotValueMoving("A read of the caller's own declared interests.")
  @Get()
  async list(@Req() request: FastifyRequest) {
    const userId = (await this.principals.resolve(request)).id;
    return { nodeIds: await this.interests.listForUser(userId) };
  }

  @NotValueMoving("Replaces one set with another; retrying the same body ends in the same state.")
  @Authorize({ kind: "me", action: "update_interests" })
  @Put()
  async replace(@Req() request: FastifyRequest, @Body() body: unknown) {
    const parsed = replaceBody.safeParse(body);
    if (!parsed.success) throw new BadRequestException("nodeIds must be an array of strings.");

    const unknownNodes = parsed.data.nodeIds.filter((id) => !isKnownInterestNode(id));
    if (unknownNodes.length > 0) {
      throw new BadRequestException(`Unknown interest node(s): ${unknownNodes.join(", ")}`);
    }

    const principal = await this.principals.resolve(request);
    if (principal.attr.ageBand === "teen") {
      const outOfReach = parsed.data.nodeIds.filter((id) => !isTeenInterestNode(id));
      if (outOfReach.length > 0) {
        throw new BadRequestException(`Not a teen-appropriate interest: ${outOfReach.join(", ")}`);
      }
    }

    await this.interests.replaceForUser(principal.id, parsed.data.nodeIds);
    return { nodeIds: parsed.data.nodeIds };
  }
}
