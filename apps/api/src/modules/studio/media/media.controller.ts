import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  HttpException,
  NotFoundException,
  Param,
  Post,
  Inject,
} from "@nestjs/common";
import { mediaReadyCallbackRequestSchema } from "@yourtal/contracts/studio/media";
import {
  MEDIA_SERVICE_SIGNATURE_HEADER,
  verifyMediaServiceRequest,
} from "@yourtal/contracts/studio/media-service-signature";
import { Authorize, PublicRoute } from "../../../shared/authz/authorize.decorator";
import { NotValueMoving } from "../../../shared/idempotency/idempotent.decorator";
import { APP_CONFIG } from "../../../config/app-config.module";
import type { AppConfig } from "../../../config/app-config";
import { CompleteMediaUploadDto } from "./dto/complete-media-upload.dto";
import { InitiateMediaUploadDto } from "./dto/initiate-media-upload.dto";
import { MediaService } from "./media.service";
import { studioMediaServiceSecret } from "./media-service-config";
import type { MediaServiceError } from "./media.service";

@Controller("api/:tenantId/studio/media")
export class MediaController {
  constructor(private readonly media: MediaService) {}

  @NotValueMoving(
    "Starts a new multipart upload against a fresh id; a duplicate call abandons the first " +
      "(an abandoned multipart upload is harmless dangling storage, and an un-completed media_assets row spends " +
      "no money and reaches no campaign). Nothing to replay: the response IS the new state.",
  )
  @Authorize({ kind: "media_asset", action: "upload" })
  @Post("initiate")
  async initiate(@Param("tenantId") tenantId: string, @Body() body: InitiateMediaUploadDto) {
    return this.media.initiate(tenantId, body);
  }

  @NotValueMoving(
    "Idempotent by construction: complete() replays the current asset for any status past " +
      '"uploading" instead of erroring, so a retried call after a network blip is a no-op.',
  )
  @Authorize({ kind: "media_asset", action: "upload" })
  @Post(":assetId/complete")
  @HttpCode(200)
  async complete(
    @Param("tenantId") tenantId: string,
    @Param("assetId") assetId: string,
    @Body() body: CompleteMediaUploadDto,
  ) {
    const result = await this.media.complete(tenantId, assetId, body);
    if (!result.ok) throw mapError(result.error);
    return result.asset;
  }

  @Authorize({ kind: "media_asset", action: "view" })
  @Get(":assetId")
  async get(@Param("tenantId") tenantId: string, @Param("assetId") assetId: string) {
    const asset = await this.media.get(tenantId, assetId);
    if (asset === null) throw new NotFoundException("No such media asset.");
    return asset;
  }
}

/**
 * `POST /internal/studio/media/:assetId/ready` (7.2.b) — the worker's
 * callback, never reachable from the public vhost (same convention as
 * `HlsAuthController`: `infra/helios/nginx`'s `/api/internal/` location
 * always 404s, so only a loopback caller ever reaches this). Authenticated
 * by `media-service-signature.ts`'s HMAC, not the PDP: the caller is a
 * process, not a principal, so `@PublicRoute` is correct here the same way
 * it is for `hls-auth`.
 */
@Controller("api/internal/studio/media")
export class MediaInternalController {
  constructor(
    private readonly media: MediaService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  @NotValueMoving(
    "Idempotent by construction (CLAUDE.md: every webhook fires twice): ready() no-ops for an " +
      "asset already in a terminal state instead of writing it twice.",
  )
  @PublicRoute(
    "Called by apps/worker over the loopback media-service-signature HMAC; the public vhost " +
      "returns 404 for every /api/internal/ path (infra/helios/nginx), so only the worker's own " +
      "process ever reaches this route.",
  )
  @Post(":assetId/ready")
  @HttpCode(200)
  async ready(
    @Param("assetId") assetId: string,
    @Body() rawBody: unknown,
    @Headers(MEDIA_SERVICE_SIGNATURE_HEADER) signatureHeader: string | undefined,
  ) {
    // Signature first, on the RAW body — never trust the parsed shape of an
    // unauthenticated request enough to have parsed it yet.
    const body = JSON.stringify(rawBody);
    const verdict = verifyMediaServiceRequest({
      secret: studioMediaServiceSecret(this.config.appEnv),
      method: "POST",
      pathAndQuery: `/api/internal/studio/media/${assetId}/ready`,
      body,
      header: signatureHeader,
    });
    if (!verdict.ok) throw new HttpException("forbidden", 403);

    const input = mediaReadyCallbackRequestSchema.parse(rawBody);
    const result = await this.media.ready(assetId, input);
    if (!result.ok) throw mapError(result.error);
    return { ok: true };
  }
}

function mapError(error: MediaServiceError): HttpException {
  if (error.kind === "not_found") return new NotFoundException("No such media asset.");
  return new HttpException(error.reason, 409);
}
