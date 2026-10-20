import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  Param,
  Post,
  Req,
  Res,
} from "@nestjs/common";
import type { FastifyReply, FastifyRequest } from "fastify";
import { createZodDto } from "nestjs-zod";
import {
  interactionCancelRequestSchema,
  interactionContinueRequestSchema,
} from "@yourtal/contracts/oidc/interaction";
import type { InteractionDetails, InteractionRedirect } from "@yourtal/contracts/oidc/interaction";
import { APP_CONFIG } from "../../config/app-config.module";
import type { AppConfig } from "../../config/app-config";
import { PublicRoute } from "../../shared/authz/authorize.decorator";
import { NotValueMoving } from "../../shared/idempotency/idempotent.decorator";
import { RateLimit } from "../../shared/rate-limit/rate-limit.decorator";
import { InteractionService } from "./interaction.service";
import { assertSameSiteJsonPost, forwardedSessionToken, toHttpException } from "./interaction-http";

class ContinueDto extends createZodDto(interactionContinueRequestSchema) {}
class CancelDto extends createZodDto(interactionCancelRequestSchema) {}

const PUBLIC_REASON =
  "the provider's interaction cookie ties the request to one sign-in in one browser, " +
  "and the forwarded YourTal session says who; no Cerbos principal is involved";

/**
 * Group 3.9 (docs/26 §1.1): the interaction API YourTal's `/connect/[uid]`
 * screens call through the web server. Each answer about the app comes from
 * YourTal's client registry, and each refusal from docs/26 §1.5.
 */
@Controller("api/connect")
export class InteractionController {
  constructor(
    private readonly interactions: InteractionService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  @RateLimit({ routeId: "oidc.interaction.details", ip: { max: 120, windowSeconds: 60 } })
  @PublicRoute(PUBLIC_REASON)
  @Get(":uid")
  async details(
    @Param("uid") uid: string,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<InteractionDetails> {
    try {
      return await this.interactions.details(
        { req: request.raw, res: reply.raw },
        uid,
        forwardedSessionToken(request),
      );
    } catch (error) {
      throw toHttpException(error);
    }
  }

  @NotValueMoving(
    "Finishing a sign-in twice gives the provider the same result twice; the provider " +
      "resumes the sign-in once, and a consent row is replaced, not added to.",
  )
  @RateLimit({ routeId: "oidc.interaction.continue", ip: { max: 30, windowSeconds: 60 } })
  @PublicRoute(PUBLIC_REASON)
  @Post(":uid/continue")
  @HttpCode(HttpStatus.OK)
  async continue(
    @Param("uid") uid: string,
    @Body() body: ContinueDto,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<InteractionRedirect> {
    assertSameSiteJsonPost(request, this.config.webOrigin);
    try {
      return await this.interactions.continue(
        { req: request.raw, res: reply.raw },
        uid,
        forwardedSessionToken(request),
        body.screen,
      );
    } catch (error) {
      throw toHttpException(error);
    }
  }

  @NotValueMoving(
    "Cancelling twice sends the same refusal to the app; nothing is moved or granted.",
  )
  @RateLimit({ routeId: "oidc.interaction.cancel", ip: { max: 30, windowSeconds: 60 } })
  @PublicRoute(PUBLIC_REASON)
  @Post(":uid/cancel")
  @HttpCode(HttpStatus.OK)
  async cancel(
    @Param("uid") uid: string,
    @Body() _body: CancelDto,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<InteractionRedirect> {
    assertSameSiteJsonPost(request, this.config.webOrigin);
    try {
      return await this.interactions.cancel(
        { req: request.raw, res: reply.raw },
        uid,
        forwardedSessionToken(request),
      );
    } catch (error) {
      throw toHttpException(error);
    }
  }
}
