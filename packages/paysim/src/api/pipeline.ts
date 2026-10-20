import { createHash, timingSafeEqual } from "node:crypto";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { DEFAULT_API_VERSION, type PaySimConfig } from "../config";
import type { Ctx } from "../ctx";
import { StripeError, idempotencyMismatch, invalidApiKey, invalidRequest } from "../errors";
import { FormError, type ParamObject, type ParamValue, parseForm } from "../form";
import { newRequestId } from "../ids";
import type { PaySimStore } from "../store";
import type { Out, Route } from "./common";

const IDEMPOTENCY_TTL_MS = 24 * 60 * 60 * 1000;

export interface PipelineDeps {
  store: PaySimStore;
  config: PaySimConfig;
  now: () => Date;
}

function digest(s: string): Buffer {
  return createHash("sha256").update(s).digest();
}

/** The key from `Authorization: Bearer <key>` or Basic `<key>:`. */
function presentedKey(header: string | undefined): string | null {
  if (header === undefined) return null;
  const bearer = /^Bearer\s+(.+)$/i.exec(header);
  if (bearer !== null) return bearer[1]?.trim() ?? null;
  const basic = /^Basic\s+(.+)$/i.exec(header);
  if (basic !== null) {
    const decoded = Buffer.from(basic[1] ?? "", "base64").toString("utf8");
    return decoded.split(":")[0] ?? null;
  }
  return null;
}

export function authenticate(header: string | undefined, config: PaySimConfig): void {
  const key = presentedKey(header);
  const match = key !== null && timingSafeEqual(digest(key), digest(config.secretKey));
  if (!match) throw invalidApiKey(key);
}

function canonical(v: ParamValue): string {
  if (typeof v === "string") return JSON.stringify(v);
  if (Array.isArray(v)) return `[${v.map(canonical).join(",")}]`;
  const keys = Object.keys(v).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonical(v[k] as ParamValue)}`).join(",")}}`;
}

function header(req: FastifyRequest, name: string): string | undefined {
  const v = req.headers[name];
  return typeof v === "string" ? v : undefined;
}

function queryParams(req: FastifyRequest): ParamObject {
  const q = req.url.indexOf("?");
  try {
    return parseForm(q < 0 ? "" : req.url.slice(q + 1));
  } catch (error) {
    if (error instanceof FormError) throw invalidRequest(error.message);
    throw error;
  }
}

function bodyParams(req: FastifyRequest): ParamObject {
  const b: unknown = req.body;
  return typeof b === "object" && b !== null ? (b as ParamObject) : parseForm("");
}

function send(reply: FastifyReply, status: number, body: string, extra: Record<string, string>) {
  return reply
    .code(status)
    .headers({ "request-id": newRequestId(), ...extra })
    .type("application/json; charset=utf-8")
    .send(body);
}

/** One Stripe API call: auth, scope, idempotency, one transaction. */
async function handle(deps: PipelineDeps, route: Route, req: FastifyRequest, reply: FastifyReply) {
  try {
    authenticate(header(req, "authorization"), deps.config);
    const post = route.method === "POST";
    const params = post ? bodyParams(req) : queryParams(req);
    const now = deps.now();
    const versionHeader = header(req, "stripe-version");
    const apiVersion =
      versionHeader !== undefined && /^[\w.-]{1,64}$/.test(versionHeader)
        ? versionHeader
        : DEFAULT_API_VERSION;
    const account = header(req, "stripe-account") ?? null;
    const idemKey = post ? (header(req, "idempotency-key") ?? null) : null;
    if (idemKey !== null && idemKey.length > 255) {
      throw invalidRequest("Idempotency keys cannot be longer than 255 characters.");
    }
    const id = (req.params as { id?: string }).id ?? "";
    const hash = createHash("sha256")
      .update(`${route.method} ${route.path}\n${id}\n${canonical(params)}`)
      .digest("hex");

    const result = await deps.store.transaction(async (tx) => {
      const ctx: Ctx = {
        tx,
        now,
        config: deps.config,
        apiVersion,
        idempotencyKey: idemKey,
        account,
      };
      if (account !== null) {
        const connected = await tx.get(account);
        if (connected?.type !== "account") {
          throw new StripeError(403, {
            type: "invalid_request_error",
            code: "account_invalid",
            message: `The provided key does not have access to account '${account.slice(0, 40)}' (or that account does not exist).`,
          });
        }
      }
      const scope = account ?? "platform";
      if (idemKey !== null) {
        const prior = await tx.getIdempotency(
          scope,
          idemKey,
          new Date(now.getTime() - IDEMPOTENCY_TTL_MS),
        );
        if (prior !== undefined) {
          if (prior.requestHash !== hash) throw idempotencyMismatch(idemKey);
          return { status: prior.status, body: prior.body, replayed: true };
        }
      }
      const out: Out = await route.run(ctx, { params, id });
      const body = JSON.stringify(out.body);
      const status = out.status ?? 200;
      if (idemKey !== null) {
        await tx.putIdempotency({
          scope,
          key: idemKey,
          requestHash: hash,
          status,
          body,
          createdAt: now,
        });
      }
      return { status, body, replayed: false };
    });
    return await send(reply, result.status, result.body, {
      "stripe-version": apiVersion,
      ...(idemKey === null ? {} : { "idempotency-key": idemKey }),
      ...(result.replayed ? { "idempotent-replayed": "true" } : {}),
    });
  } catch (error) {
    if (error instanceof StripeError) {
      return send(reply, error.status, JSON.stringify(error.body), {});
    }
    throw error;
  }
}

export function registerApiRoutes(app: FastifyInstance, deps: PipelineDeps, routes: Route[]): void {
  for (const route of routes) {
    app.route({
      method: route.method,
      url: route.path,
      handler: (req, reply) => handle(deps, route, req, reply),
    });
  }
}
