import { randomBytes, randomUUID } from "node:crypto";
import type { NestFastifyApplication } from "@nestjs/platform-fastify";

/**
 * One real, authenticated user for a test — registered and logged in
 * through the real `POST /api/auth/register` and `/login` routes, not
 * fabricated. 1.3.d (TASKS.md): every area's tests that need "a signed-in
 * caller" go through this rather than each inventing its own fixture.
 *
 * `token` is a real `SessionService`-issued opaque token: `AuthService`
 * already validates it (logout, change-password), and as of 1.5.a
 * `PrincipalService.resolve` validates it too — `cookie` is the real
 * `yt_session` mechanism, not a placeholder.
 *
 * 1.5.a deleted this interface's old `headers` field (`x-yt-user-id` and
 * friends) along with the header path in `PrincipalService` it fed — every
 * caller that used to spread `session.headers` into a request now sends
 * `Cookie: session.cookie` (or `Authorization: Bearer ${session.token}`)
 * instead.
 */
export interface TestSession {
  readonly userId: string;
  readonly email: string;
  /** The raw session token `SessionService.issue` minted at login. */
  readonly token: string;
  /** `Cookie` header value, read by `PrincipalService.resolve` (1.5.a). */
  readonly cookie: string;
}

export interface SessionForOptions {
  /** Defaults to a fresh, unique address — never reuse a real inbox in a test. */
  readonly email?: string;
  /** Defaults to a value that satisfies `registerSchema`'s `.min(12)` and is obviously not real. */
  readonly password?: string;
  /** The account's real `region` (1.4.c, `identity.user_profile.region`). Defaults to `"AU"`, matching 0.5.a. */
  readonly jurisdiction?: "AU" | "ID";
  /** Defaults to an obviously-adult date of birth — pass a recent one to test the age policy. */
  readonly dateOfBirth?: string;
}

/** en-AU for AU, id-ID for ID — same pairing `RegionConfig` in `@yourtal/contracts/region` uses. */
function localeFor(jurisdiction: "AU" | "ID"): "en-AU" | "id-ID" {
  return jurisdiction === "AU" ? "en-AU" : "id-ID";
}

const SESSION_COOKIE_NAME = "yt_session";

/**
 * Registers and logs in a fresh user against a real, already-booted app
 * (`app.inject`, the same mechanism `app.boot.test.ts` uses) — a real HTTP
 * round trip and a real row in `identity.credential`/`identity.session`,
 * not a mock.
 *
 * Each call uses a distinct fake source IP (`remoteAddress`), because
 * `REGISTER_RATE_LIMIT` and `LOGIN_RATE_LIMIT` are per-IP (5/hour and
 * 30/15min) and every call through `app.inject` would otherwise share one
 * address — a suite calling this more than 5 times would start failing on
 * a rate limit that has nothing to do with what it is testing.
 */
export async function sessionFor(
  app: NestFastifyApplication,
  options: SessionForOptions = {},
): Promise<TestSession> {
  const email = options.email ?? `session-for+${randomUUID()}@example.test`;
  const password = options.password ?? "session-for-not-a-real-secret-1";
  const jurisdiction = options.jurisdiction ?? "AU";
  // Comfortably 18+ by default (1.4.b's minimum) so ordinary tests never
  // brush against the age policy by accident; pass `dateOfBirth` to test it.
  const dateOfBirth = options.dateOfBirth ?? "1990-01-01";
  const remoteAddress = randomTestIp();

  const registered = await app.inject({
    method: "POST",
    url: "/api/auth/register",
    remoteAddress,
    headers: { "idempotency-key": randomUUID() },
    payload: {
      email,
      password,
      region: jurisdiction,
      locale: localeFor(jurisdiction),
      displayName: "Session For",
      dateOfBirth,
      timezone: "Australia/Sydney",
    },
  });
  if (registered.statusCode >= 400) {
    throw new Error(
      `sessionFor: POST /api/auth/register failed (${String(registered.statusCode)}): ${registered.body}`,
    );
  }

  const loggedIn = await app.inject({
    method: "POST",
    url: "/api/auth/login",
    remoteAddress,
    payload: { email, password },
  });
  if (loggedIn.statusCode >= 400) {
    throw new Error(
      `sessionFor: POST /api/auth/login failed (${String(loggedIn.statusCode)}): ${loggedIn.body}`,
    );
  }

  const { userId, token } = readLoginResponse(loggedIn.json());

  return {
    userId,
    email,
    token,
    cookie: `${SESSION_COOKIE_NAME}=${token}`,
  };
}

/** A distinct address per call — never a real one, and never the same one twice. */
function randomTestIp(): string {
  const octets = randomBytes(3);
  const second = octets[0];
  const third = octets[1];
  const fourth = octets[2];
  if (second === undefined || third === undefined || fourth === undefined) {
    throw new Error("randomBytes(3) returned fewer than 3 bytes");
  }
  // 10.0.0.0/8 — private-use (RFC 1918), never a routable address a real
  // rate-limit bucket would ever legitimately see.
  return `10.${String(second)}.${String(third)}.${String(fourth)}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function readLoginResponse(body: unknown): { userId: string; token: string } {
  if (isRecord(body) && typeof body.userId === "string" && typeof body.token === "string") {
    return { userId: body.userId, token: body.token };
  }
  throw new Error(`sessionFor: unexpected /api/auth/login response shape: ${JSON.stringify(body)}`);
}
