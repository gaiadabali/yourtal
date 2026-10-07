import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { expect, type APIRequestContext } from "@playwright/test";
import { Pool } from "pg";
import {
  API,
  REGIONS,
  apiLogin,
  apiRegister,
  demoEmail,
  inboxToken,
  testIp,
  type RegionCase,
} from "./demo";

/**
 * 13.3.b: shared setup for the business-side journeys (1, 2, 3, 4, 8, 12),
 * run against a local demo world (13.1). Each journey checks the database
 * rows its step should write, through `DATABASE_OWNER_URL`, as well as the
 * screens and API responses.
 */
export function requireBusinessEnv(): void {
  if (API === "" || (process.env["DEMO_PASSWORD"] ?? "") === "") {
    throw new Error("Set JOURNEY_API_URL (or API_INTERNAL_URL) and DEMO_PASSWORD.");
  }
  if ((process.env["DATABASE_OWNER_URL"] ?? "") === "") {
    throw new Error("Set DATABASE_OWNER_URL: the business journeys check database rows.");
  }
}

let pool: Pool | undefined;
export function db(): Pool {
  pool ??= new Pool({ connectionString: process.env["DATABASE_OWNER_URL"], max: 2 });
  return pool;
}
export async function closeDb(): Promise<void> {
  await pool?.end();
  pool = undefined;
}

export async function one<T extends Record<string, unknown>>(
  sql: string,
  params: unknown[],
): Promise<T> {
  const { rows } = await db().query<T>(sql, params);
  expect(rows.length, `expected one row for: ${sql}`).toBe(1);
  return rows[0] as T;
}

/** An API caller signed in as a demo person, with idempotency keys on writes. */
export interface Caller {
  readonly token: string;
  readonly userId: string;
  get<T>(path: string): Promise<T>;
  post<T>(path: string, body: unknown, status?: number): Promise<T>;
  put<T>(path: string, body: unknown): Promise<T>;
  patch<T>(path: string, body: unknown): Promise<T>;
}

export function callerFor(
  request: APIRequestContext,
  session: { token: string; userId: string },
): Caller {
  const headers = { authorization: `Bearer ${session.token}`, "x-forwarded-for": testIp() };
  const send = async <T>(
    method: "post" | "put" | "patch",
    path: string,
    body: unknown,
    status?: number,
  ) => {
    const response = await request[method](`${API}${path}`, {
      headers: { ...headers, "idempotency-key": randomUUID() },
      data: body,
    });
    const text = await response.text();
    if (status !== undefined) expect(response.status(), `${method} ${path}: ${text}`).toBe(status);
    else expect(response.ok(), `${method} ${path}: ${text}`).toBeTruthy();
    return (text === "" ? {} : JSON.parse(text)) as T;
  };
  return {
    ...session,
    async get<T>(path: string) {
      const response = await request.get(`${API}${path}`, { headers });
      expect(response.ok(), `GET ${path}: ${await response.text()}`).toBeTruthy();
      return (await response.json()) as T;
    },
    post: (path, body, status) => send("post", path, body, status),
    put: (path, body) => send("put", path, body),
    patch: (path, body) => send("patch", path, body),
  };
}

export async function demoCaller(request: APIRequestContext, person: string, r: RegionCase) {
  return callerFor(request, await apiLogin(request, demoEmail(person, r)));
}

export async function staffCaller(
  request: APIRequestContext,
  role: "ops" | "moderator" | "finance" | "admin" | "support",
) {
  return callerFor(request, await apiLogin(request, `${role}@demo.yourtal.test`));
}

/** The demo business the region's demo owner, marketer and finance work at. */
export async function demoBusinessId(caller: Caller): Promise<string> {
  const memberships =
    await caller.get<{ business: { id: string; region: string } }[]>("/api/me/businesses");
  const first = memberships[0]?.business.id;
  expect(first, "the demo person belongs to no business; run pnpm demo:reset").toBeDefined();
  return first as string;
}

const catalogues = new Map<string, Record<string, unknown>>();
/** A string from the web's own catalogue in the region's locale, so each journey reads its own language. */
export function msg(r: RegionCase, namespace: string, key: string): string {
  const file = new URL(`../../messages/${r.locale}/${namespace}.json`, import.meta.url);
  let data = catalogues.get(file.href);
  if (!data) {
    data = JSON.parse(readFileSync(file, "utf8")) as Record<string, unknown>;
    catalogues.set(file.href, data);
  }
  const value = key
    .split(".")
    .reduce<unknown>((node, part) => (node as Record<string, unknown>)[part], data);
  expect(typeof value, `${r.locale}/${namespace}.json has no ${key}`).toBe("string");
  return value as string;
}

/** Exact-match pattern for a catalogue string, ignoring ICU placeholders. */
export function exact(text: string): RegExp {
  const parts = text.split(/\{[^}]*\}/).map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  return new RegExp(`^${parts.join(".+")}$`);
}

const TAX_IDS = {
  AU: {
    taxIdKind: "ABN",
    taxIdValue: "51824753556",
    addressState: "VIC",
    addressPostcode: "3000",
    addressCity: null,
  },
  ID: {
    taxIdKind: "NIB",
    taxIdValue: "9120001234567",
    addressState: null,
    addressPostcode: null,
    addressCity: "Denpasar",
  },
} as const;

/** A fresh business in the region, KYB-approved by demo ops (journey 1 proves those steps on screen). */
export async function verifiedBusiness(
  request: APIRequestContext,
  r: RegionCase,
  roles: readonly ("advertiser" | "supplier" | "redeemer")[],
  prefix: string,
) {
  const owner = callerFor(request, await apiRegister(request, r, `${prefix}-owner`));
  const handle = `${prefix}-${r.slug}-${Date.now().toString(36)}`;
  const { business } = await owner.post<{ business: { id: string } }>("/api/businesses", {
    legalName: `${handle} Pty`,
    displayName: `${prefix} ${r.region}`,
    handle,
    roles,
    region: r.region,
    logoUrl: null,
    coverUrl: null,
    ...TAX_IDS[r.region],
  });
  const ops = await staffCaller(request, "ops");
  await ops.post(`/api/staff/businesses/${business.id}/kyb/approve`, {
    reason: "Journey fixture.",
  });
  return { owner, businessId: business.id };
}

/** Invites a fresh person by role and accepts as them (journey 1 proves this on screen). */
export async function addMember(
  request: APIRequestContext,
  owner: Caller,
  businessId: string,
  r: RegionCase,
  role: "admin" | "marketer" | "merchandiser" | "finance" | "analyst",
) {
  const account = await apiRegister(request, r, role);
  await owner.post(`/api/${businessId}/business/team/invite`, { email: account.email, role });
  const token = await inboxToken(request, account.email, "team_invitation");
  const member = callerFor(request, account);
  await member.post("/api/me/businesses/invitations/accept", { token });
  return member;
}

/** Either locale's string, exactly: for a screen that has not learned its region yet. */
export function eitherLocale(namespace: string, key: string): RegExp {
  const esc = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`^(${REGIONS.map((r) => esc(msg(r, namespace, key))).join("|")})$`);
}
