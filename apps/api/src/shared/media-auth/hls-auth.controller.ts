import { Controller, Get, Headers, HttpCode, HttpException, Inject } from "@nestjs/common";
import { APP_CONFIG } from "../../config/app-config.module";
import type { AppConfig } from "../../config/app-config";
import { PublicRoute } from "../authz/authorize.decorator";
import { verifyHlsUri } from "./hls-token";

/**
 * `GET /api/internal/hls-auth`: nginx's `auth_request` target for
 * `/media/hls/` (infra/helios/nginx). nginx passes the original URI in
 * `X-Original-URI`; 204 lets the segment through, 403/410 refuse it. The
 * public vhost never routes `/api/internal/` here, so only nginx's
 * subrequest can reach it.
 */
@Controller("api/internal/hls-auth")
export class HlsAuthController {
  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {}

  @PublicRoute(
    "Called by nginx for every HLS request, with no user session; the signed URL " +
      "itself is the credential, and the route is unreachable from outside nginx.",
  )
  @Get()
  @HttpCode(204)
  check(@Headers("x-original-uri") uri: string | undefined): void {
    const secret = this.config.hlsSigningSecret;
    // Fail closed: no secret configured means no video, never unsigned video.
    if (secret === undefined || uri === undefined) throw new HttpException("forbidden", 403);
    const verdict = verifyHlsUri(secret, uri, Math.floor(Date.now() / 1000));
    if (verdict === "expired") throw new HttpException("expired", 410);
    if (verdict !== "ok") throw new HttpException("forbidden", 403);
  }
}
