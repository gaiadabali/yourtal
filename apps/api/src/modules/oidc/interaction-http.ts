import {
  ConflictException,
  ForbiddenException,
  HttpException,
  HttpStatus,
  NotFoundException,
  UnauthorizedException,
} from "@nestjs/common";
import type { FastifyRequest } from "fastify";
import { bearerToken } from "../auth/bearer-token";
import { InteractionError } from "./interaction.service";

/** The YourTal session the web server forwarded: a Bearer token, else the `yt_session` cookie. */
export function forwardedSessionToken(request: FastifyRequest): string {
  const bearer = bearerToken(request);
  if (bearer.length > 0) return bearer;
  const raw = request.headers.cookie;
  if (raw === undefined) return "";
  for (const part of raw.split(";")) {
    const separator = part.indexOf("=");
    if (separator !== -1 && part.slice(0, separator).trim() === "yt_session") {
      return part.slice(separator + 1).trim();
    }
  }
  return "";
}

/**
 * CSRF, the way the web's server actions are protected: a POST must come from
 * YourTal's own origin or from a server (which sends neither header), and
 * must be JSON, which no cross-site form can send without a preflight. The
 * interaction cookie is also scoped to `/connect/<uid>`, so a browser never
 * sends it to `/api` on its own.
 */
export function assertSameSiteJsonPost(request: FastifyRequest, webOrigin: string): void {
  const contentType = request.headers["content-type"] ?? "";
  if (!contentType.toLowerCase().startsWith("application/json")) {
    throw new HttpException(
      { code: "unsupported_media_type", message: "send the body as application/json" },
      HttpStatus.UNSUPPORTED_MEDIA_TYPE,
    );
  }
  const site = request.headers["sec-fetch-site"];
  const origin = request.headers.origin;
  const crossSite = typeof site === "string" && site !== "same-origin" && site !== "none";
  if (crossSite || (origin !== undefined && origin !== webOrigin)) {
    throw new ForbiddenException({
      code: "origin_refused",
      message: "this request came from another site",
    });
  }
}

export function toHttpException(error: unknown): Error {
  if (!(error instanceof InteractionError)) {
    return error instanceof Error ? error : new Error("oidc: interaction failed");
  }
  switch (error.code) {
    case "interaction_not_found":
      return new NotFoundException({
        code: error.code,
        message: "this sign-in has ended or belongs to another browser",
      });
    case "session_required":
      return new UnauthorizedException({ code: error.code, message: "sign in to YourTal first" });
    case "screen_changed":
      return new ConflictException({ code: error.code, message: "reload the sign-in screen" });
    case "sign_in_refused":
      return new ForbiddenException({
        code: error.code,
        message: "YourTal cannot sign this account in to this app",
        refusal: error.refusal,
      });
  }
}
