import { Inject, Injectable } from "@nestjs/common";
import type { FastifyRequest } from "fastify";
import { PrincipalService } from "../../shared/authz/principal.service";
import type { ResourceAttributeLoader } from "../../shared/authz/resource-attribute-loader";
import { USER_PROFILE_REPOSITORY } from "../identity/persistence/user-profile.repository";
import type { UserProfileRepository } from "../identity/persistence/user-profile.repository";
import { AUCTION_STORE, type AuctionStore } from "./persistence/auction-store";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The `auction` resource (13.22): a named auction's own region and seller;
 * for a list, the caller's own region, so the wall still applies.
 */
@Injectable()
export class AuctionAttributeLoader implements ResourceAttributeLoader<"auction"> {
  readonly kind = "auction" as const;

  constructor(
    private readonly principals: PrincipalService,
    @Inject(AUCTION_STORE) private readonly store: AuctionStore,
    @Inject(USER_PROFILE_REPOSITORY) private readonly profiles: UserProfileRepository,
  ) {}

  async resolve(
    request: FastifyRequest,
  ): Promise<{ readonly id: string; readonly attr: Readonly<Record<string, unknown>> } | null> {
    const params: unknown = request.params;
    const auctionId: unknown =
      typeof params === "object" && params !== null ? Reflect.get(params, "auctionId") : undefined;
    if (typeof auctionId === "string") {
      if (!UUID.test(auctionId)) return null;
      const auction = await this.store.get(this.store.db, auctionId);
      if (auction === null) return null;
      return { id: auction.id, attr: { region: auction.region, sellerId: auction.sellerId } };
    }
    const principal = await this.principals.resolve(request);
    const profile = principal.roles.includes("user")
      ? await this.profiles.findByUserId(principal.id)
      : null;
    return { id: "list", attr: { region: profile?.region ?? principal.attr.jurisdiction } };
  }
}
