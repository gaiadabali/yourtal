import { randomUUID } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";
import { API, REGIONS, apiRegister, inboxToken, testIp, useSession, type RegionCase } from "./demo";
import { callerFor, closeDb, db, msg, one, requireBusinessEnv, staffCaller } from "./business";

const STAFF = REGIONS[0]; // the staff console runs in en-AU

/** A plausible tax id per region (13.3.b: ABN in AU, NIB in ID). */
const TAX_ID = { AU: { kind: "ABN", value: "51824753556" }, ID: { kind: "NIB", value: "9120001234567" } };

/**
 * Journey 1 (product-intent §2.2): the owner registers a business in Studio,
 * in their own region (fixed), uploads a KYB document that ops approves in
 * the staff console, and invites a team member by role, who joins through
 * Studio's join screen. Checks the business, member, KYB, invitation and
 * staff audit rows, and that neither the business nor the team crosses the
 * region wall.
 */
test.afterAll(closeDb);

async function signInAs(page: Page, baseURL: string, token: string, r: RegionCase) {
  await page.context().clearCookies();
  await useSession(page.context(), baseURL, token, r);
}

for (const r of REGIONS) {
  test(`J1 ${r.region}: register a business, pass KYB, invite a marketer`, async ({
    page,
    request,
    baseURL,
  }) => {
    test.setTimeout(240_000);
    requireBusinessEnv();
    const ownerAccount = await apiRegister(request, r, "j01-owner");
    const owner = callerFor(request, ownerAccount);
    const handle = `j01-${r.slug}-${Date.now().toString(36)}`;

    // Studio sends a person with no business to onboarding; they register one.
    await signInAs(page, baseURL!, ownerAccount.token, r);
    await page.goto("/studio");
    await expect(page).toHaveURL(/\/studio\/onboarding/);
    await page.getByLabel(msg(r, "studio", "onboarding.legalNameLabel")).fill(`Journey ${handle} Pty`);
    await page.getByLabel(msg(r, "studio", "onboarding.displayNameLabel")).fill(`Journey ${r.region}`);
    await page.getByLabel(msg(r, "studio", "onboarding.handleLabel")).fill(handle);
    await page
      .getByRole("checkbox", { name: msg(r, "studio", "onboarding.role.supplier.title") })
      .check({ force: true });
    await page.getByLabel(msg(r, "studio", "onboarding.taxIdKindLabel")).selectOption(TAX_ID[r.region].kind);
    await page.getByLabel(msg(r, "studio", "onboarding.taxIdValueLabel")).fill(TAX_ID[r.region].value);
    if (r.region === "AU") {
      await page.getByLabel(msg(r, "studio", "onboarding.stateLabel")).selectOption("VIC");
      await page.getByLabel(msg(r, "studio", "onboarding.postcodeLabel")).fill("3000");
    } else {
      await page.getByLabel(msg(r, "studio", "onboarding.cityLabel")).fill("Denpasar");
    }
    await page.getByRole("button", { name: msg(r, "studio", "onboarding.createBusiness") }).click();
    await expect(page).toHaveURL(/\/studio(\?|$)/);

    const business = await one<{
      id: string;
      region: string;
      currency: string;
      roles: string[];
      is_verified: boolean;
      tax_id_kind: string;
    }>(
      `SELECT id::text, region, currency, roles, is_verified, tax_id_kind
         FROM business.business_accounts WHERE handle = $1`,
      [handle],
    );
    expect(business).toMatchObject({
      region: r.region,
      currency: r.region === "AU" ? "AUD" : "IDR",
      is_verified: false,
      tax_id_kind: TAX_ID[r.region].kind,
    });
    expect([...business.roles].sort()).toEqual(["advertiser", "supplier"]);
    const ownerRow = await one<{ role: string }>(
      `SELECT role FROM business.business_members WHERE business_id = $1 AND user_id = $2`,
      [business.id, ownerAccount.userId],
    );
    expect(ownerRow.role).toBe("owner");

    // The region is the owner's own: a business in the other region is refused.
    const other = REGIONS.find((x) => x.region !== r.region)!;
    const crossed = await request.post(`${API}/api/businesses`, {
      headers: {
        authorization: `Bearer ${ownerAccount.token}`,
        "idempotency-key": randomUUID(),
        "x-forwarded-for": testIp(),
      },
      data: {
        legalName: "Cross region",
        displayName: "Cross region",
        handle: `${handle}-x`,
        roles: ["advertiser"],
        region: other.region,
        taxIdKind: TAX_ID[other.region].kind,
        taxIdValue: TAX_ID[other.region].value,
        addressState: other.region === "AU" ? "VIC" : null,
        addressPostcode: other.region === "AU" ? "3000" : null,
        addressCity: other.region === "ID" ? "Denpasar" : null,
        logoUrl: null,
        coverUrl: null,
      },
    });
    expect(crossed.status(), await crossed.text()).toBe(403);

    // KYB: the owner uploads a document from the overview's banner.
    await page.getByLabel(msg(r, "studio", "chrome.verification.fileLabel")).setInputFiles({
      name: "registration.pdf",
      mimeType: "application/pdf",
      buffer: Buffer.from("%PDF-1.4\n% journey 1 registration certificate\n%%EOF\n"),
    });
    await page.getByRole("button", { name: msg(r, "studio", "chrome.verification.submit") }).click();
    await expect(page.getByText(msg(r, "studio", "chrome.verification.submittedMessage"))).toBeVisible();
    await page.reload();
    await expect(page.getByText(msg(r, "studio", "chrome.verification.submittedMessage"))).toBeVisible();
    const kyb = await one<{ status: string; storage_ref: string; document_type: string }>(
      `SELECT status, storage_ref, document_type FROM business.kyb_documents WHERE business_id = $1`,
      [business.id],
    );
    expect(kyb).toMatchObject({ status: "submitted", document_type: "business_registration_certificate" });
    expect(kyb.storage_ref.startsWith(`kyb/${business.id}/`)).toBe(true);

    // Ops reviews it in the staff console and approves.
    const ops = await staffCaller(request, "ops");
    await signInAs(page, baseURL!, ops.token, STAFF);
    await page.goto(`/staff/businesses/${business.id}`);
    await expect(page.getByText(msg(STAFF, "staff", "businesses.documentStatus.submitted"))).toBeVisible();
    await page.getByRole("button", { name: msg(STAFF, "staff", "businesses.approveKybCta") }).click();
    await page.getByLabel(msg(STAFF, "staff", "dialog.reasonLabel")).fill("Registration certificate matches.");
    await page
      .getByRole("button", { name: msg(STAFF, "staff", "businesses.approveKybSubmit"), exact: true })
      .last()
      .click();
    await expect(
      page.getByText(msg(STAFF, "staff", "businesses.verified"), { exact: true }).first(),
    ).toBeVisible();
    const verified = await one<{ is_verified: boolean; doc: string }>(
      `SELECT b.is_verified, d.status AS doc FROM business.business_accounts b
         JOIN business.kyb_documents d ON d.business_id = b.id WHERE b.id = $1`,
      [business.id],
    );
    expect(verified).toEqual({ is_verified: true, doc: "verified" });
    const audit = await one<{ actor: string; outcome: string; region: string | null; reason: string }>(
      `SELECT actor_user_id AS actor, outcome, region, reason FROM staff.audit_event
        WHERE action = 'business.kyb.approve' AND target_id = $1`,
      [business.id],
    );
    expect(audit).toEqual({
      actor: ops.userId,
      outcome: "succeeded",
      region: r.region,
      reason: "Registration certificate matches.",
    });

    // The owner invites a marketer from Team; the invitee joins through Studio.
    const inviteeAccount = await apiRegister(request, r, "j01-marketer");
    await signInAs(page, baseURL!, ownerAccount.token, r);
    await page.goto(`/studio/team?business=${business.id}`);
    await page.getByRole("button", { name: msg(r, "studio", "team.screen.inviteMember") }).click();
    await page.getByLabel(msg(r, "studio", "team.invite.emailLabel")).fill(inviteeAccount.email);
    await page.getByLabel(msg(r, "studio", "team.invite.roleLabel")).selectOption("marketer");
    await page.getByRole("button", { name: msg(r, "studio", "team.invite.send") }).click();
    await expect(page.getByRole("dialog")).toBeHidden();
    const invitation = await one<{ role: string; accepted_at: Date | null }>(
      `SELECT role, accepted_at FROM business.team_invitations WHERE business_id = $1 AND email = $2`,
      [business.id, inviteeAccount.email],
    );
    expect(invitation).toEqual({ role: "marketer", accepted_at: null });
    const code = await inboxTokenOf(request, inviteeAccount.email);

    // Someone in the other region cannot use the code to join across the wall,
    // and the code stays good for the invitee.
    const outsider = await apiRegister(request, other, "j01-outsider");
    const crossJoin = await callerFor(request, outsider).post<{ code: string }>(
      "/api/me/businesses/invitations/accept",
      { token: code },
      400,
    );
    expect(crossJoin.code).toBe("invitation_invalid");

    await signInAs(page, baseURL!, inviteeAccount.token, r);
    await page.goto("/studio/onboarding");
    await page.getByRole("link", { name: msg(r, "studio", "onboarding.joinInstead") }).click();
    await page.getByLabel(msg(r, "studio", "join.codeLabel")).fill(code);
    await page.getByRole("button", { name: msg(r, "studio", "join.submit") }).click();
    await expect(page).toHaveURL(new RegExp(`/studio\\?business=${business.id}`));
    // A marketer cannot see billing, and still gets a working overview.
    await expect(page.getByText(`Journey ${r.region}`).first()).toBeVisible();
    await expect(page.getByText(msg(r, "studio", "chrome.error.message"))).toHaveCount(0);
    const member = await one<{ role: string }>(
      `SELECT role FROM business.business_members WHERE business_id = $1 AND user_id = $2`,
      [business.id, inviteeAccount.userId],
    );
    expect(member.role).toBe("marketer");
    const accepted = await one<{ accepted_by: string }>(
      `SELECT accepted_by_user_id::text AS accepted_by FROM business.team_invitations
        WHERE business_id = $1 AND email = $2`,
      [business.id, inviteeAccount.email],
    );
    expect(accepted.accepted_by).toBe(inviteeAccount.userId);
    const memberships = await callerFor(request, inviteeAccount).get<{ business: { id: string } }[]>(
      "/api/me/businesses",
    );
    expect(memberships.map((m) => m.business.id)).toEqual([business.id]);
    await page.screenshot({ path: `test-results/j01-joined-${r.slug}.png`, fullPage: true });
  });
}

/** The invitation code from the newest team invitation email to `email`. */
async function inboxTokenOf(request: Parameters<typeof inboxToken>[0], email: string) {
  const response = await request.get(`${API}/api/dev/inbox`);
  expect(response.ok()).toBeTruthy();
  const { entries } = (await response.json()) as {
    entries: { recipient: string; category: string; createdAt: string; metadata: Record<string, unknown> }[];
  };
  const match = entries
    .filter((e) => e.recipient === email && e.category === "team_invitation")
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
  expect(match, `no team invitation email for ${email}`).toBeDefined();
  return String(match?.metadata["token"]);
}
