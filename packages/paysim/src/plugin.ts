import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { PaySimConfig } from "./config";
import { StripeError, invalidRequest, unrecognizedUrl } from "./errors";
import { FormError, parseForm } from "./form";
import { assertPaySimAllowed } from "./gate";
import { accountRoutes } from "./api/accounts";
import { customerRoutes } from "./api/customers";
import { intentRoutes } from "./api/intents";
import { moneyRoutes } from "./api/money";
import { paymentIntentRoutes } from "./api/payment-intents";
import { registerApiRoutes } from "./api/pipeline";
import { refundRoutes } from "./api/refunds";
import { sessionRoutes } from "./api/sessions";
import { registerCheckoutPages } from "./pages/checkout";
import { securityHeaders } from "./pages/layout";
import { registerOnboardingPages } from "./pages/onboarding";
import type { PaySimStore } from "./store";

export interface RegisterPaySimOptions {
  /** Mount point, e.g. `/api/paysim`; `""` for the standalone server. */
  prefix: string;
  store: PaySimStore;
  /** Read on every request, so a caller may fill `publicBaseUrl` after listening. */
  config: PaySimConfig;
  now?: () => Date;
}

const BODY_LIMIT = 1024 * 1024;

const ROUTES = [
  ...customerRoutes,
  ...sessionRoutes,
  ...paymentIntentRoutes,
  ...intentRoutes,
  ...refundRoutes,
  ...accountRoutes,
  ...moneyRoutes,
];

function errorBody(error: unknown): { status: number; body: object } {
  if (error instanceof StripeError) return { status: error.status, body: error.body };
  const status = (error as { statusCode?: unknown }).statusCode;
  if (typeof status === "number" && status >= 400 && status < 500) {
    const message = status === 413 ? "The request body is too large." : "Invalid request.";
    return { status: 400, body: { error: { type: "invalid_request_error", message } } };
  }
  return {
    status: 500,
    body: { error: { type: "api_error", message: "An unknown error occurred." } },
  };
}

/**
 * Mounts the Stripe simulation: `/v1/*` JSON, plus the checkout, 3-D Secure
 * and Connect onboarding pages. Everything is one encapsulated plugin, so its
 * form parser and handlers never touch the host app's routes.
 */
export async function registerPaySim(
  app: FastifyInstance,
  opts: RegisterPaySimOptions,
): Promise<void> {
  assertPaySimAllowed(opts.config.appEnv);
  const deps = { store: opts.store, config: opts.config, now: opts.now ?? (() => new Date()) };
  const apiPrefix = `${opts.prefix}/v1/`;
  const isApi = (req: FastifyRequest): boolean =>
    (req.url.split("?")[0] ?? "").startsWith(apiPrefix);

  const htmlError = (reply: FastifyReply, status: number): FastifyReply =>
    reply
      .code(status)
      .headers(securityHeaders([]))
      .type("text/html; charset=utf-8")
      .send("<!doctype html><title>Error</title><p>Something went wrong.</p>");

  await app.register(
    (scope, _opts, done) => {
      // Form bodies only; nothing else is ever parsed, and no body is logged.
      scope.removeAllContentTypeParsers();
      scope.addContentTypeParser(
        "application/x-www-form-urlencoded",
        { parseAs: "string", bodyLimit: BODY_LIMIT },
        (_req, body, done) => {
          try {
            done(null, parseForm(typeof body === "string" ? body : ""));
          } catch (error) {
            done(error instanceof FormError ? invalidRequest(error.message) : (error as Error));
          }
        },
      );
      scope.addContentTypeParser("*", { parseAs: "string" }, (_req, body, done) => {
        if (body === "") done(null, undefined);
        else done(invalidRequest("Request bodies must be application/x-www-form-urlencoded."));
      });

      scope.setErrorHandler((error, req, reply) => {
        const { status, body } = errorBody(error);
        if (status >= 500) req.log.error({ err: error }, "paysim error");
        if (!isApi(req)) return htmlError(reply, status);
        return reply.code(status).type("application/json; charset=utf-8").send(body);
      });
      scope.setNotFoundHandler((req, reply) => {
        if (!isApi(req)) return htmlError(reply, 404);
        const path = req.url.split("?")[0] ?? "";
        return reply
          .code(404)
          .type("application/json; charset=utf-8")
          .send(unrecognizedUrl(req.method, path).body);
      });

      registerApiRoutes(scope, deps, ROUTES);
      registerCheckoutPages(scope, deps);
      registerOnboardingPages(scope, deps);
      done();
    },
    { prefix: opts.prefix },
  );
}
