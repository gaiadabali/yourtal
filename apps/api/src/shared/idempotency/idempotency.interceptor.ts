import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  HttpException,
} from "@nestjs/common";
import type { CallHandler, ExecutionContext, NestInterceptor } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { Observable, from, of, switchMap } from "rxjs";
import { catchError, tap } from "rxjs/operators";
import type { FastifyReply, FastifyRequest } from "fastify";
import { begin, complete, abandon } from "@yourtal/idempotency/idempotency";
import type { IdempotencyStore } from "@yourtal/idempotency/store";
import { IDEMPOTENT_METADATA } from "./idempotent.decorator";
import type { IdempotentOptions } from "./idempotent.decorator";
import { IDEMPOTENCY_STORE } from "./idempotency.module";
import { AsyncPrincipalResolver } from "../authz/async-principal-resolver";

/**
 * Applies `@yourtal/idempotency` to routes marked `@Idempotent`. YT-0039.
 *
 * Registered globally, but only acts on routes carrying the decorator —
 * `mutating-routes.test.ts` is what makes sure no mutating route is missing
 * one. Registering it globally rather than per-controller means a new module
 * inherits the behaviour instead of having to remember it.
 *
 * `docs/13a` fixes the middleware order as
 * `... auth -> Cerbos -> idempotency -> module`. An interceptor runs after
 * guards, which puts this in the right place: by the time it runs the caller
 * is authenticated and authorized, so the scope comes from something we
 * verified rather than from anything the client sent. That ordering is a
 * security property — an unauthenticated caller must not be able to write to
 * the idempotency table at all, or they could pre-poison a key and have a
 * legitimate request replay their stored response.
 */
@Injectable()
export class IdempotencyInterceptor implements NestInterceptor {
  constructor(
    private readonly reflector: Reflector,
    @Inject(IDEMPOTENCY_STORE) private readonly store: IdempotencyStore,
    private readonly principals: AsyncPrincipalResolver,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const options = this.reflector.get<IdempotentOptions | undefined>(
      IDEMPOTENT_METADATA,
      context.getHandler(),
    );
    if (options === undefined) {
      return next.handle();
    }

    const http = context.switchToHttp();
    const request = http.getRequest<FastifyRequest>();
    const reply = http.getResponse<FastifyReply>();

    const key = firstHeader(request.headers["idempotency-key"]);
    if (key === undefined) {
      // docs/09 section 214: mandatory on every call. A missing key on a
      // route that declared itself idempotent is a client bug, and accepting
      // it would quietly give up the guarantee for that request.
      throw new BadRequestException({
        type: "invalid_request_error",
        code: "idempotency_key_required",
        message: "This endpoint requires an Idempotency-Key header.",
      });
    }

    return from(this.scopeFor(request)).pipe(
      switchMap((scope) =>
        from(
          begin(this.store, {
            scope,
            key,
            method: request.method,
            path: request.url,
            rawBody: rawBodyOf(request),
            startedAt: new Date(),
            retentionMs: options.retentionMs,
          }),
        ).pipe(
          switchMap((outcome) =>
            this.handleOutcome(outcome, scope, key, reply, next, options.redact),
          ),
        ),
      ),
    );
  }

  /**
   * Split out of `intercept()` only so `scopeFor` (YT-0582: now an async,
   * DB-reading resolve) can sit ahead of it in an outer `switchMap` without
   * this whole method's body living inside a second level of nesting.
   */
  private handleOutcome(
    outcome: Awaited<ReturnType<typeof begin>>,
    scope: string,
    key: string,
    reply: FastifyReply,
    next: CallHandler,
    redact: ((value: unknown) => unknown) | undefined,
  ): Observable<unknown> {
    if (outcome.kind === "fingerprint_mismatch") {
      throw new ConflictException({
        type: "idempotency_error",
        code: "idempotency_key_reused",
        message: "This Idempotency-Key was already used with a different request body.",
      });
    }
    if (outcome.kind === "in_progress") {
      throw new ConflictException({
        type: "idempotency_error",
        code: "idempotency_request_in_progress",
        message: "An earlier request with this Idempotency-Key is still being processed.",
      });
    }
    if (outcome.kind === "replay") {
      reply.status(outcome.status);
      // Re-serialised by Nest rather than written byte for byte. The
      // value is identical; the bytes may differ in key order if the
      // handler returned a differently-ordered object. Storing the
      // serialised form keeps it stable for the common case and avoids
      // bypassing the framework's own response pipeline.
      return of(parseStoredBody(outcome.body));
    }

    return next.handle().pipe(
      tap((value: unknown) => {
        // `redact` runs only on what gets PERSISTED — `value` itself, the
        // response this exact call sends the client, is untouched. A
        // replay later reads back whatever was stored here, so this is the
        // one place that decides what a replay can ever return.
        const stored = redact === undefined ? value : redact(value);
        void complete(this.store, scope, key, {
          status: reply.statusCode,
          body: JSON.stringify(stored),
        });
      }),
      catchError((error: unknown) => {
        void this.recordFailure(scope, key, error);
        throw error;
      }),
    );
  }

  /**
   * A 4xx means the request never reached the value path, so `docs/12` keeps
   * it retryable and the claim is released. A 5xx may have executed
   * partially, so it is STORED and replayed — re-running a value operation
   * because the first attempt failed is how a partial failure becomes a
   * double charge.
   */
  private async recordFailure(scope: string, key: string, error: unknown): Promise<void> {
    const status = error instanceof HttpException ? error.getStatus() : 500;

    if (status < 500) {
      await abandon(this.store, scope, key);
      return;
    }
    await complete(this.store, scope, key, {
      status,
      body: JSON.stringify(
        error instanceof HttpException
          ? error.getResponse()
          : { type: "api_error", code: "internal_error" },
      ),
    });
  }

  /**
   * `docs/14` section 6 scopes the key `(merchant, key)`, so a tenant-scoped
   * route scopes by tenant: two staff at one merchant retrying the same
   * logical operation share a key, which is the point. Routes with no tenant
   * in the path fall back to the principal, which is the tightest scope
   * available and never wider than the caller.
   *
   * Never taken from the body. A scope a client can choose is a scope a
   * client can choose to collide with.
   *
   * Async since YT-0582: the principal fallback now goes through
   * `AsyncPrincipalResolver`, which can read stored state. This runs AFTER
   * `PdpGuard` (docs/13a's fixed order), so the id it scopes by has already
   * been through one authorization decision either way — this call does not
   * change what is trusted, only what the resolver is capable of knowing
   * about the id it already trusted.
   */
  private async scopeFor(request: FastifyRequest): Promise<string> {
    const params: unknown = request.params;
    if (typeof params === "object" && params !== null && "tenantId" in params) {
      const tenantId: unknown = Reflect.get(params, "tenantId");
      if (typeof tenantId === "string" && tenantId.length > 0) {
        return `tenant:${tenantId}`;
      }
    }
    return `principal:${(await this.principals.resolve(request)).id}`;
  }
}

function firstHeader(value: string | string[] | undefined): string | undefined {
  const header = Array.isArray(value) ? value[0] : value;
  return header === undefined || header.length === 0 ? undefined : header;
}

/**
 * The raw body as received. `main.ts` enables Fastify's `rawBody` so the
 * fingerprint hashes what the client actually sent rather than a
 * re-serialisation of the parsed object — see `@yourtal/idempotency`'s
 * `fingerprint.ts` for why canonical JSON was avoided.
 */
function rawBodyOf(request: FastifyRequest): string {
  const raw: unknown = Reflect.get(request, "rawBody");
  if (typeof raw === "string") return raw;
  if (raw instanceof Buffer) return raw.toString("utf8");
  // No body (a DELETE, say) hashes as the empty string, consistently.
  return request.body === undefined ? "" : JSON.stringify(request.body);
}

function parseStoredBody(body: string): unknown {
  try {
    return JSON.parse(body);
  } catch {
    return body;
  }
}
