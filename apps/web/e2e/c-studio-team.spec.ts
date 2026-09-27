import { expect, test } from "@playwright/test";
import type { APIRequestContext, Browser, BrowserContext, Page } from "@playwright/test";

/**
 * 7.8.b's Team-zone live wiring, proven end to end against a real
 * `apps/api` (`YOURTAL_DATA_SOURCE=live`; see `playwright.c-studio.config.ts`,
 * reused here — `testMatch: "c-studio-*.spec.ts"` picks this file up too):
 * invite by email through the real dialog, accept the real invitation
 * (7.1.c's `POST /api/me/businesses/invitations/accept`) using the token
 * from `/dev/inbox` (there is no web UI for accepting an invite yet, so
 * this step goes through the API directly, the same way
 * `b-register-login.spec.ts`'s email-verification test calls
 * `/api/auth/email/verify/request` directly), then confirms the new member
 * appears in the roster on a fresh page load — proving `listTeam` (
 * `team-data.ts`) reads the real `GET /api/:tenantId/business/team`, not a
 * stale local copy.
 */
function apiBaseUrl(): string {
  const url = process.env["API_INTERNAL_URL"];
  if (url === undefined || url === "") {
    throw new Error(
      "API_INTERNAL_URL is not set — source this worktree's .env before running this spec.",
    );
  }
  return url;
}

function uniqueSuffix(): string {
  return `${Date.now()}-${Math.floor(Math.random() * 1_000_000)}`;
}

interface LiveAccount {
  email: string;
  password: string;
  userId: string;
  cookie: string;
}

async function registerAndLogIn(request: APIRequestContext, prefix: string): Promise<LiveAccount> {
  const suffix = uniqueSuffix();
  const email = `${prefix}-${suffix}@example.test`;
  const password = "c-studio-team-not-a-real-secret-1";

  const registered = await request.post(`${apiBaseUrl()}/api/auth/register`, {
    headers: { "idempotency-key": crypto.randomUUID() },
    data: {
      email,
      password,
      region: "AU",
      locale: "en-AU",
      displayName: `${prefix} E2E`,
      dateOfBirth: "1990-01-01",
      timezone: "Australia/Sydney",
    },
  });
  expect(registered.ok(), await registered.text()).toBeTruthy();

  const loggedIn = await request.post(`${apiBaseUrl()}/api/auth/login`, {
    data: { email, password },
  });
  expect(loggedIn.ok(), await loggedIn.text()).toBeTruthy();
  const body = (await loggedIn.json()) as { userId: string; token: string };

  return { email, password, userId: body.userId, cookie: `yt_session=${body.token}` };
}

async function newSessionContext(
  browser: Browser,
  baseURL: string,
  cookie: string,
): Promise<{ context: BrowserContext; page: Page }> {
  const [name, value] = cookie.split("=");
  const context = await browser.newContext();
  await context.addCookies([{ name: name as string, value: value as string, url: baseURL }]);
  const page = await context.newPage();
  return { context, page };
}

interface DevInboxEntry {
  readonly recipient: string;
  readonly category: string;
  readonly metadata: Record<string, unknown>;
  readonly createdAt: string;
}

/** Reads the invite token out of the newest matching simulated email (1.6.b's `/api/dev/inbox`), same pattern `b-register-login.spec.ts`'s `latestToken` uses for its own categories. */
async function latestInvitationToken(
  request: APIRequestContext,
  recipient: string,
): Promise<string> {
  const response = await request.get(`${apiBaseUrl()}/api/dev/inbox`);
  expect(response.ok()).toBeTruthy();
  const body = (await response.json()) as { entries: DevInboxEntry[] };
  const matches = body.entries
    .filter((entry) => entry.recipient === recipient && entry.category === "team_invitation")
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  expect(matches.length, `no team_invitation email found for ${recipient}`).toBeGreaterThan(0);
  const token = matches[0]?.metadata["token"];
  expect(typeof token).toBe("string");
  return token as string;
}

test.describe.serial("7.8.b: Team — invite, accept via /dev/inbox, roster updates live", () => {
  let owner: LiveAccount;
  let invitee: LiveAccount;
  let businessId: string;
  const businessHandle = `c-team-${uniqueSuffix()}`;

  test.beforeAll(async ({ request }) => {
    owner = await registerAndLogIn(request, "c-team-owner");
    invitee = await registerAndLogIn(request, "c-team-invitee");
  });

  test("owner creates a business, then invites the second account by email", async ({
    browser,
    baseURL,
  }) => {
    const { context, page } = await newSessionContext(browser, baseURL as string, owner.cookie);

    await page.goto("/studio/onboarding");
    await page.getByLabel("Legal name").fill("C Studio Team E2E Pty Ltd");
    await page.getByLabel("Display name").fill("C Studio Team E2E");
    await page.getByLabel("Handle").fill(businessHandle);
    await page.getByLabel("Tax ID number").fill("12345678901");
    await page.getByLabel("State").selectOption("NSW");
    await page.getByLabel("Postcode").fill("2000");
    await page.getByRole("button", { name: "Create business" }).click();
    await expect(page).toHaveURL(/\/studio(\?|$)/);

    const memberships = await context.request.get(`${apiBaseUrl()}/api/me/businesses`, {
      headers: { cookie: owner.cookie },
    });
    expect(memberships.ok()).toBeTruthy();
    const businesses = (await memberships.json()) as Array<{
      business: { id: string; handle: string };
    }>;
    const created = businesses.find((entry) => entry.business.handle === businessHandle);
    expect(created).toBeDefined();
    businessId = created?.business.id as string;

    await page.goto(`/studio/team?business=${businessId}`);
    await expect(page.getByRole("heading", { name: "Team", level: 1 })).toBeVisible();
    // Only the owner so far.
    await expect(page.getByRole("row")).toHaveCount(2); // header row + owner's own row

    await page.getByRole("button", { name: "Invite member" }).click();
    await page.getByLabel("Email").fill(invitee.email);
    // Role left at its default ("Marketer") — see `team-invite-dialog.tsx`.
    await page.getByRole("button", { name: "Send invite" }).click();

    // Dialog closes on success; a real invite creates no roster row yet
    // (see `team-screen.tsx`'s own doc comment) — only a `team_invitations`
    // row, until accepted below.
    await expect(page.getByRole("dialog")).toBeHidden();
    await expect(page.getByText(`You invited ${invitee.email} as Marketer`)).toBeVisible();
    await expect(page.getByRole("row")).toHaveCount(2);

    await context.close();
  });

  test("the invitee accepts the real invitation (token from /dev/inbox), then appears in the owner's roster", async ({
    browser,
    baseURL,
    request,
  }) => {
    const token = await latestInvitationToken(request, invitee.email);

    // No web UI accepts a team invitation yet — go straight through the
    // real endpoint, the same way `b-register-login.spec.ts`'s
    // email-verification test calls its own real endpoint directly.
    const accepted = await request.post(`${apiBaseUrl()}/api/me/businesses/invitations/accept`, {
      headers: { cookie: invitee.cookie },
      data: { token },
    });
    expect(accepted.ok(), await accepted.text()).toBeTruthy();

    const { context, page } = await newSessionContext(browser, baseURL as string, owner.cookie);
    await page.goto(`/studio/team?business=${businessId}`);

    const shortId = invitee.userId.slice(0, 8);
    await expect(page.getByRole("row")).toHaveCount(3); // header + owner + the newly-accepted invitee
    // The invitee's own row shows their real invited role and "Active" status.
    const inviteeRow = page.getByRole("row").filter({ hasText: shortId });
    await expect(inviteeRow).toBeVisible();
    await expect(inviteeRow.getByText("Marketer")).toBeVisible();
    await expect(inviteeRow.getByText("Active")).toBeVisible();

    await context.close();
  });
});
