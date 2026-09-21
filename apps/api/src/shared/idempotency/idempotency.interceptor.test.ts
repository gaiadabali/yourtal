import { BadRequestException, ConflictException, HttpException } from "@nestjs/common";
import type { CallHandler, ExecutionContext } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { firstValueFrom, of, throwError } from "rxjs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { InMemoryIdempotencyStore } from "@yourtal/idempotency/in-memory-store";
import { IdempotencyInterceptor } from "./idempotency.interceptor";
import { IDEMPOTENT_METADATA } from "./idempotent.decorator";
import { ONBOARDING_RETENTION_MS } from "./retention";
import { AsyncPrincipalResolver } from "../authz/async-principal-resolver";
import { PrincipalService } from "./../authz/principal.service";
import type { AppConfig } from "../../config/app-config";
import type { PrincipalSecurityStateRepository } from "../../modules/identity/persistence/principal-security-state.repository";

// Every context in this suite carries a tenantId, so the principal fallback
// in `scopeFor` (and the database read behind it) is never reached.
const NO_SECURITY_STATE: PrincipalSecurityStateRepository = {
  findByUserId: () => Promise.resolve(null),
};

/**
 * The half `mutating-routes.test.ts` cannot cover: that the interceptor
 * actually replays, conflicts and releases. The route scan proves a route is
 * DECLARED idempotent; this proves the declaration does something.
 */

const CONFIG: AppConfig = {
  nodeEnv: "test",
  port: 3001,
  pdp: { baseUrl: "http://127.0.0.1:3592", timeoutMs: 500 },
  // Required since YT-0552. These suites do not touch it, but a config
  // object that can omit it would mean the type still permits the
  // fallback this ticket removed.
  databaseUrl: "postgres://yourtal_app:app_local_only@127.0.0.1:26432/yourtal",
};

let store: InMemoryIdempotencyStore;
let interceptor: IdempotencyInterceptor;
let statusCode: number;

beforeEach(() => {
  store = new InMemoryIdempotencyStore();
  statusCode = 201;

  const reflector = new Reflector();
  vi.spyOn(reflector, "get").mockImplementation((key: unknown) =>
    key === IDEMPOTENT_METADATA ? { retentionMs: ONBOARDING_RETENTION_MS } : undefined,
  );

  interceptor = new IdempotencyInterceptor(
    reflector,
    store,
    new AsyncPrincipalResolver(new PrincipalService(CONFIG), NO_SECURITY_STATE),
  );
});

function contextWith(headers: Record<string, string>, body: string): ExecutionContext {
  const request = {
    method: "POST",
    url: "/api/biz-kopi/business/team/invite",
    headers,
    params: { tenantId: "biz-kopi" },
    rawBody: body,
    body: JSON.parse(body),
  };
  const reply = {
    status: (code: number) => {
      statusCode = code;
      return reply;
    },
    get statusCode() {
      return statusCode;
    },
  };

  return {
    // Only the two members the interceptor actually reaches for. Stubbing
    // the rest of ExecutionContext would be inventing a contract this test
    // does not exercise.
    getHandler: () => () => undefined,
    switchToHttp: () => ({ getRequest: () => request, getResponse: () => reply }),
  } as unknown as ExecutionContext;
}

function handlerReturning(value: unknown): CallHandler {
  return { handle: () => of(value) };
}

function handlerThrowing(error: unknown): CallHandler {
  return { handle: () => throwError(() => error) };
}

const HEADERS = { "idempotency-key": "key-1" };
const BODY = '{"userId":"u1","role":"analyst"}';

describe("the first request", () => {
  it("runs the handler and stores the response", async () => {
    const result = await firstValueFrom(
      interceptor.intercept(contextWith(HEADERS, BODY), handlerReturning({ memberId: "m1" })),
    );

    expect(result).toEqual({ memberId: "m1" });
    expect(store.size).toBe(1);
  });
});

describe("a retry", () => {
  it("replays without running the handler again", async () => {
    await firstValueFrom(
      interceptor.intercept(contextWith(HEADERS, BODY), handlerReturning({ memberId: "m1" })),
    );

    const secondHandler = { handle: vi.fn(() => of({ memberId: "m2" })) };
    const result = await firstValueFrom(
      interceptor.intercept(contextWith(HEADERS, BODY), secondHandler),
    );

    // The handler must not run. If it did, the invite is sent twice.
    expect(secondHandler.handle).not.toHaveBeenCalled();
    expect(result).toEqual({ memberId: "m1" });
  });

  it("409s when the same key carries a different body", async () => {
    await firstValueFrom(
      interceptor.intercept(contextWith(HEADERS, BODY), handlerReturning({ memberId: "m1" })),
    );

    await expect(
      firstValueFrom(
        interceptor.intercept(
          contextWith(HEADERS, '{"userId":"u2","role":"owner"}'),
          handlerReturning({ memberId: "m2" }),
        ),
      ),
    ).rejects.toBeInstanceOf(ConflictException);
  });
});

describe("the key header", () => {
  it("is required on a route that declared itself idempotent", () => {
    expect(() =>
      interceptor.intercept(contextWith({}, BODY), handlerReturning({ memberId: "m1" })),
    ).toThrow(BadRequestException);
  });
});

describe("failures", () => {
  it("leaves a 4xx retryable", async () => {
    // docs/12: a request that failed validation never reached the value path,
    // so it is not saved and the client may fix it and retry.
    await expect(
      firstValueFrom(
        interceptor.intercept(
          contextWith(HEADERS, BODY),
          handlerThrowing(new HttpException("bad", 400)),
        ),
      ),
    ).rejects.toBeInstanceOf(HttpException);

    const after = { handle: vi.fn(() => of({ memberId: "m1" })) };
    await firstValueFrom(interceptor.intercept(contextWith(HEADERS, BODY), after));
    expect(after.handle).toHaveBeenCalled();
  });

  it("stores a 5xx and replays it rather than re-running the operation", async () => {
    // The counterintuitive one. If the operation partially executed before
    // failing, re-running it on retry turns a partial failure into a double.
    await expect(
      firstValueFrom(
        interceptor.intercept(
          contextWith(HEADERS, BODY),
          handlerThrowing(new HttpException("boom", 500)),
        ),
      ),
    ).rejects.toBeInstanceOf(HttpException);

    const after = { handle: vi.fn(() => of({ memberId: "m1" })) };
    await firstValueFrom(interceptor.intercept(contextWith(HEADERS, BODY), after));

    expect(after.handle).not.toHaveBeenCalled();
  });
});

describe("scoping", () => {
  it("does not leak a response across tenants", async () => {
    await firstValueFrom(
      interceptor.intercept(contextWith(HEADERS, BODY), handlerReturning({ memberId: "m1" })),
    );

    const rival = contextWith(HEADERS, BODY);
    Reflect.set(rival.switchToHttp().getRequest(), "params", { tenantId: "biz-rival" });

    const handler = { handle: vi.fn(() => of({ memberId: "m9" })) };
    const result = await firstValueFrom(interceptor.intercept(rival, handler));

    expect(handler.handle).toHaveBeenCalled();
    expect(result).toEqual({ memberId: "m9" });
  });
});
