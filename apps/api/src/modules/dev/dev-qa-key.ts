import { createHash, timingSafeEqual } from "node:crypto";
import { Inject, Injectable } from "@nestjs/common";
import type { OnModuleInit } from "@nestjs/common";
import { HttpAdapterHost } from "@nestjs/core";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { APP_CONFIG } from "../../config/app-config.module";
import type { AppConfig } from "../../config/app-config";

const DEV_PREFIX = "/api/dev/";

/**
 * The gate in front of every `/api/dev/*` route (staging test kit, K1.3): the
 * caller must send `x-qa-key` equal to `STAGING_QA_KEY`. Without the key
 * configured, or on production, every such route answers 404 for everyone, so
 * nginx can pass `/api/dev/` through and the API alone decides. Runs as an
 * `onRequest` hook, before the rate limiter and the PDP, so a caller without
 * the key cannot tell a dev route from a missing one.
 */
export function devRouteOpen(
  config: Pick<AppConfig, "appEnv" | "stagingQaKey">,
  given: string | string[] | undefined,
): boolean {
  const key = config.stagingQaKey;
  if (config.appEnv === "production" || key === undefined || key === "") return false;
  if (typeof given !== "string") return false;
  // Hash both sides so the compare is constant-time whatever the lengths.
  return timingSafeEqual(digest(given), digest(key));
}

function digest(value: string): Buffer {
  return createHash("sha256").update(value, "utf8").digest();
}

function isDevRoute(request: FastifyRequest): boolean {
  const matched = request.routeOptions.url;
  const path = (request.url.split("?")[0] ?? "").toLowerCase();
  return matched?.startsWith(DEV_PREFIX) === true || path.startsWith(DEV_PREFIX);
}

export function registerDevQaKey(
  instance: FastifyInstance,
  config: Pick<AppConfig, "appEnv" | "stagingQaKey">,
): void {
  instance.addHook("onRequest", async (request, reply) => {
    if (!isDevRoute(request) || devRouteOpen(config, request.headers["x-qa-key"])) return;
    await reply.code(404).send({ statusCode: 404, message: "Not Found" });
  });
}

/** Registered as the app initialises, so `main.ts` and every test app built from `AppModule` share it. */
@Injectable()
export class DevQaKeyHook implements OnModuleInit {
  constructor(
    private readonly adapterHost: HttpAdapterHost,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  onModuleInit(): void {
    registerDevQaKey(this.adapterHost.httpAdapter.getInstance<FastifyInstance>(), this.config);
  }
}
