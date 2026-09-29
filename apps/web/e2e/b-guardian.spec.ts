import { randomUUID } from "node:crypto";
import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import type { APIRequestContext, Browser, Page } from "@playwright/test";
import { Pool } from "pg";

/**
 * 12.2.c's own Check, live: a real 14-year-old account (`TEEN_ACCOUNTS=true`
 * on this worktree's api), the real guardian-consent email in the dev
 * outbox, and the real page — pending -> approve -> granted -> (`?action=
 * revoke`) -> revoked — each state's own real DB row
 * (`identity.user_profile.parent_consent_status`), plus screenshots at
 * 390/1280 px, light/dark, axe-clean.
 *
 * Registers exactly ONE teen account for the whole file.
 * `REGISTER_RATE_LIMIT` is 5/IP/hour (see `b-register-login.spec.ts`'s own
 * comment) and every other e2e file sharing this worktree's IP draws from
 * the same budget. The three states this ticket must prove are a ONE-WAY
 * conveyor for a single link (approve, then later revoke, is final) — so
 * the 390/1280 x light/dark matrix for each state is shot from FRESH
 * browser contexts that only ever GET the page (`GUARDIAN_CONSENT_VIEW_
 * RATE_LIMIT` is 30/IP/15min, comfortably enough for 12 reads), while the
 * one real approve and the one real revoke each happen exactly once, in
 * their own dedicated context, between matrices.
 */
const WCAG_AA = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"];
const SCREENSHOT_DIR =
  "C:/Users/Hansel/AppData/Local/Temp/claude/c--Users-Hansel-Documents-Hansel-Projects-yourtal/8b7a9841-bc91-4309-8b6a-dca2ffbaf048/scratchpad/12.2.c";

const VIEWPORTS = [
  { name: "390", width: 390, height: 844 },
  { name: "1280", width: 1280, height: 800 },
] as const;
const THEMES = ["light", "dark"] as const;

function apiBaseUrl(): string {
  const url = process.env["API_INTERNAL_URL"];
  if (url === undefined || url === "") {
    throw new Error(
      "API_INTERNAL_URL is not set — source this worktree's .env before running this spec.",
    );
  }
  return url;
}

function dbPool(): Pool {
  const url = process.env["DATABASE_OWNER_URL"];
  if (url === undefined || url === "") {
    throw new Error(
      "DATABASE_OWNER_URL is not set — source this worktree's .env before running this spec.",
    );
  }
  return new Pool({ connectionString: url });
}

async function parentConsentStatusFor(pool: Pool, userId: string): Promise<string | null> {
  const { rows } = await pool.query<{ parent_consent_status: string }>(
    `SELECT parent_consent_status FROM identity.user_profile WHERE user_id = $1`,
    [userId],
  );
  return rows[0]?.parent_consent_status ?? null;
}

interface DevInboxEntry {
  readonly recipient: string;
  readonly category: string;
  readonly metadata: Record<string, unknown>;
  readonly createdAt: string;
}

/** Reads the guardian consent token out of the newest matching simulated email (1.6.b's `/api/dev/inbox`), the same way `b-register-login.spec.ts` reads a reset/verify token. */
async function latestGuardianToken(
  request: APIRequestContext,
  guardianEmail: string,
): Promise<string> {
  const response = await request.get(`${apiBaseUrl()}/api/dev/inbox`);
  expect(response.ok()).toBeTruthy();
  const body = (await response.json()) as { entries: DevInboxEntry[] };
  const matches = body.entries
    .filter((entry) => entry.recipient === guardianEmail && entry.category === "guardian_consent")
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  expect(matches.length, `no guardian_consent email found for ${guardianEmail}`).toBeGreaterThan(
    0,
  );
  const token = matches[0]?.metadata["token"];
  expect(typeof token).toBe("string");
  return token as string;
}

/** Opens a fresh context per viewport/theme combo, runs `visit`, screenshots and axe-checks the result. Read-only by construction — `visit` never submits anything. */
async function shotEveryCombo(
  browser: Browser,
  stateName: string,
  visit: (page: Page) => Promise<void>,
): Promise<void> {
  for (const viewport of VIEWPORTS) {
    for (const colorScheme of THEMES) {
      const context = await browser.newContext({
        viewport: { width: viewport.width, height: viewport.height },
        colorScheme,
      });
      const page = await context.newPage();
      await visit(page);
      await page.screenshot({
        path: `${SCREENSHOT_DIR}/guardian-${stateName}-${viewport.name}-${colorScheme}.png`,
      });
      const axe = await new AxeBuilder({ page }).withTags(WCAG_AA).analyze();
      expect(
        axe.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target).join(" | ")}`),
      ).toStrictEqual([]);
      await context.close();
    }
  }
}

test.describe.serial("12.2.c: /guardian/[token] — pending -> granted -> revoked, live", () => {
  let pool: Pool;
  let token: string;
  let userId: string;
  const displayName = `Guardian E2E Teen ${Date.now()}`;
  const guardianEmail = `guardian-e2e-${Date.now()}@example.test`;

  test.beforeAll(async ({ request }) => {
    pool = dbPool();
    const registered = await request.post(`${apiBaseUrl()}/api/auth/register`, {
      headers: { "idempotency-key": randomUUID() },
      data: {
        email: `guardian-e2e-teen-${Date.now()}@example.test`,
        password: "guardian-e2e-not-a-real-secret-1",
        region: "AU",
        locale: "en-AU",
        displayName,
        // 14 years old as of any date after 2026-01-01 (12.1.a's own fixture uses the same date).
        dateOfBirth: "2012-01-01",
        timezone: "Australia/Sydney",
        guardianEmail,
      },
    });
    expect(registered.ok(), await registered.text()).toBeTruthy();
    const body = (await registered.json()) as { userId: string };
    userId = body.userId;
    token = await latestGuardianToken(request, guardianEmail);

    expect(await parentConsentStatusFor(pool, userId)).toBe("pending");
  });

  test.afterAll(async () => {
    await pool.end();
  });

  test("pending: renders at every viewport/theme, axe-clean, then approves for a real granted DB row", async ({
    browser,
    page,
  }) => {
    const pendingHeading = `Approve ${displayName}'s account`;

    await shotEveryCombo(browser, "pending", async (p) => {
      await p.goto(`/guardian/${token}`);
      await expect(p.getByRole("heading", { name: pendingHeading })).toBeVisible();
    });

    await page.goto(`/guardian/${token}`);
    const approveButton = page.getByRole("button", { name: "Approve" });
    await expect(approveButton).toBeDisabled();
    await page.getByRole("checkbox").check();
    await expect(approveButton).toBeEnabled();
    await approveButton.click();

    await expect(
      page.getByRole("heading", { name: `You've approved ${displayName}'s account` }),
    ).toBeVisible();
    expect(await parentConsentStatusFor(pool, userId)).toBe("granted");
  });

  test("granted: renders at every viewport/theme, axe-clean, then ?action=revoke opens the withdraw confirm directly and revokes for a real revoked DB row", async ({
    browser,
    page,
  }) => {
    const grantedHeading = `You've approved ${displayName}'s account`;

    await shotEveryCombo(browser, "granted", async (p) => {
      await p.goto(`/guardian/${token}`);
      await expect(p.getByRole("heading", { name: grantedHeading })).toBeVisible();
    });

    await page.goto(`/guardian/${token}?action=revoke`);
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await expect(dialog.getByText("Withdraw approval?")).toBeVisible();
    await dialog.getByRole("button", { name: "Yes, withdraw approval" }).click();

    await expect(page.getByRole("heading", { name: "Approval withdrawn" })).toBeVisible();
    expect(await parentConsentStatusFor(pool, userId)).toBe("revoked");
  });

  test("revoked: renders at every viewport/theme, axe-clean, and the link is final (no controls left)", async ({
    browser,
  }) => {
    await shotEveryCombo(browser, "revoked", async (p) => {
      await p.goto(`/guardian/${token}`);
      await expect(p.getByRole("heading", { name: "Approval withdrawn" })).toBeVisible();
      await expect(p.getByRole("button")).toHaveCount(0);
    });
  });

  test("an unknown token gets a real 404 and the plain 'this link isn't valid' page", async ({
    page,
  }) => {
    const response = await page.goto(`/guardian/${randomUUID()}`);
    expect(response?.status()).toBe(404);
    await expect(page.getByRole("heading", { name: "This link isn't valid" })).toBeVisible();
  });
});
