import { Inject, Injectable } from "@nestjs/common";
import type { FastifyRequest } from "fastify";
import { z } from "zod";
import type { ResourceAttributeLoader } from "../../shared/authz/resource-attribute-loader";
import {
  CAMPAIGN_AUTHZ_ATTRIBUTES_READER,
  type CampaignAuthzAttributesReader,
} from "../campaign/persistence/campaign-authz-attributes";
import { WATCH_SESSION_REPOSITORY } from "./persistence/drizzle-watch-session.repository";
import type { WatchSessionRepository } from "./persistence/drizzle-watch-session.repository";

const bodyWithCampaignId = z.object({ campaignId: z.uuid() });

/**
 * 1.5.d (EW-03): every `campaign_view` route in `watch.controller.ts` in one
 * place, so `campaign_view.yaml`'s rules — which key on `R.attr.state` — see
 * a real value instead of the empty object that shipped originally and got
 * every one of these routes silently denied under real Cerbos.
 *
 * `POST /api/watch/sessions` names its campaign in the body; the campaign
 * module's own `GET /api/campaigns/:campaignId` names one in the URL;
 * everything else in `watch/` and `watch/checkpoint/` names a SESSION in the
 * URL and the campaign is a hop away through it. Trying params.campaignId,
 * then a session lookup, then the body, keeps this one loader correct for
 * every `campaign_view` route without any of them needing to know how
 * Cerbos gets fed.
 *
 * `GET /api/campaigns` (no id of any kind — a list) is exactly why
 * `resolve` can say "not mine" (`undefined`) rather than only "not found"
 * (`null`, see `campaign-idFor` never resolving neither `undefined` nor a
 * fabricated placeholder for a route that names no single campaign at all).
 */
@Injectable()
export class CampaignViewAttributeLoader implements ResourceAttributeLoader<"campaign_view"> {
  readonly kind = "campaign_view" as const;

  constructor(
    @Inject(CAMPAIGN_AUTHZ_ATTRIBUTES_READER)
    private readonly campaigns: CampaignAuthzAttributesReader,
    @Inject(WATCH_SESSION_REPOSITORY) private readonly sessions: WatchSessionRepository,
  ) {}

  async resolve(
    request: FastifyRequest,
  ): Promise<
    { readonly id: string; readonly attr: Readonly<Record<string, unknown>> } | null | undefined
  > {
    const campaignId = await this.campaignIdFor(request);
    if (campaignId === undefined) return undefined;

    const campaign = await this.campaigns.findById(campaignId);
    if (campaign === null) return null;

    return {
      id: campaign.campaignId,
      attr: {
        campaignId: campaign.campaignId,
        state: campaign.state,
        region: campaign.region,
        audience: campaign.audience,
        openViewingEnabled: campaign.openViewingEnabled,
      },
    };
  }

  /** `undefined` means the request names no campaign of any kind — see the class comment. */
  private async campaignIdFor(request: FastifyRequest): Promise<string | undefined> {
    const params: unknown = request.params;
    const paramValue = (name: string): string | undefined => {
      if (typeof params !== "object" || params === null || !(name in params)) return undefined;
      const value: unknown = Reflect.get(params, name);
      return typeof value === "string" && value.length > 0 ? value : undefined;
    };

    const campaignIdParam = paramValue("campaignId");
    if (campaignIdParam !== undefined) return campaignIdParam;

    const sessionId = paramValue("sessionId");
    if (sessionId !== undefined) {
      const session = await this.sessions.findById(sessionId);
      // A session id that resolves to nothing is still "named but not
      // found" from THIS loader's point of view, so it returns undefined
      // here (there is no campaign to say is missing) and lets the guard's
      // ordinary path proceed — the controller's own `loadOwnSession` gives
      // the real 404 a moment later, the same division of labour
      // `watch.controller.ts`'s own doc comment already draws for ownership.
      return session?.campaignId;
    }

    const parsedBody = bodyWithCampaignId.safeParse(request.body);
    return parsedBody.success ? parsedBody.data.campaignId : undefined;
  }
}
