import { randomUUID } from "node:crypto";
import { expect, type APIRequestContext, type Page } from "@playwright/test";

/**
 * 13.3.a: shared setup for the viewer journeys, run against a demo world (13.1).
 * `JOURNEY_BASE_URL` is the site (local web or staging), `JOURNEY_API_URL` its
 * API (the same origin on staging), `DEMO_PASSWORD` the demo logins' password.
 */
export const API = process.env["JOURNEY_API_URL"] ?? process.env["API_INTERNAL_URL"] ?? "";
export const DEMO_PASSWORD = process.env["DEMO_PASSWORD"] ?? "";

export const REGIONS = [
  { region: "AU", slug: "au", locale: "en-AU", label: "Australia", language: "English (Australia)" },
  { region: "ID", slug: "id", locale: "id-ID", label: "Indonesia", language: "Bahasa Indonesia" },
] as const;
export type RegionCase = (typeof REGIONS)[number];

export const demoEmail = (person: string, r: RegionCase) =>
  `${person}.${r.slug}@demo.yourtal.test`;

export function requireDemoEnv(): void {
  if (API === "" || DEMO_PASSWORD === "") {
    throw new Error("Set JOURNEY_API_URL (or API_INTERNAL_URL) and DEMO_PASSWORD for the journeys.");
  }
}

export async function apiLogin(request: APIRequestContext, email: string, password = DEMO_PASSWORD) {
  const response = await request.post(`${API}/api/auth/login`, { data: { email, password } });
  expect(response.ok(), `login ${email}: ${await response.text()}`).toBeTruthy();
  return (await response.json()) as { userId: string; token: string };
}

export async function apiGet<T>(request: APIRequestContext, token: string | null, path: string): Promise<T> {
  const response = await request.get(`${API}${path}`, {
    headers: token ? { authorization: `Bearer ${token}` } : {},
  });
  expect(response.ok(), `GET ${path}: ${response.status()}`).toBeTruthy();
  return (await response.json()) as T;
}

/** Signs in through the real form; the session cookie then rides every page. */
export async function signIn(page: Page, email: string, password = DEMO_PASSWORD): Promise<void> {
  await page.goto("/login");
  await page.getByLabel(/^(Email)$/).fill(email);
  await page.getByLabel(/^(Password|Kata sandi)$/).fill(password);
  await page.getByRole("button", { name: /^(Sign in|Masuk)$/ }).click();
  await page.waitForURL((url) => !url.pathname.startsWith("/login"), { timeout: 60_000 });
}

/** The newest simulated email of a kind (the dev inbox), for its token. */
export async function inboxToken(
  request: APIRequestContext,
  recipient: string,
  category: "email_verification" | "password_reset",
): Promise<string> {
  const response = await request.get(`${API}/api/dev/inbox`);
  expect(response.ok()).toBeTruthy();
  const { entries } = (await response.json()) as {
    entries: { recipient: string; category: string; createdAt: string; metadata: Record<string, unknown> }[];
  };
  const match = entries
    .filter((e) => e.recipient === recipient && e.category === category)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
  expect(match, `no ${category} email for ${recipient}`).toBeDefined();
  return String(match?.metadata["token"]);
}

export function freshAccount(prefix: string) {
  const id = `${Date.now()}-${randomUUID().slice(0, 6)}`;
  return {
    email: `${prefix}-${id}@example.test`,
    password: `journey-${randomUUID()}`,
    displayName: `Journey ${prefix}`,
  };
}
