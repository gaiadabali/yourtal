import { expect, test } from "@playwright/test";
import { apiGet, freshAccount, inboxToken, REGIONS, requireDemoEnv } from "./demo";

/**
 * Journey 5 (product-intent §2.2): arrive from a shared campaign link, register
 * with email and password in a fixed region (language en-AU unless chosen),
 * verify the email, give consents, pick interests, and land back on the campaign.
 */
for (const r of REGIONS) {
  test(`J5 ${r.region}: a shared campaign link → register → verify → consents → interests → back on the campaign`, async ({
    page,
    request,
  }) => {
    requireDemoEnv();
    const feed = await apiGet<{ items: { campaignId: string; kind: string }[] }>(
      request,
      null,
      `/api/feed?surface=home&region=${r.region}`,
    );
    const campaignId = feed.items.find((i) => i.kind === "long_form")?.campaignId;
    expect(campaignId, "the demo world has a long video").toBeDefined();

    // The shared link a friend would send.
    await page.goto(`/${r.slug}/c/${campaignId}`);
    const signUp = page.getByRole("link", { name: /sign up|daftar/i }).first();
    await expect(signUp).toBeVisible();
    await signUp.click();
    if (page.url().includes("/login")) {
      await page.getByRole("link", { name: /create an account|buat akun|register|daftar/i }).first().click();
    }
    await expect(page).toHaveURL(/\/register/);
    expect(decodeURIComponent(page.url())).toContain(`/watch/${campaignId}`);

    const account = freshAccount(`j5-${r.slug}`);
    await page.getByLabel("Email").fill(account.email);
    await page.getByLabel(/^(Password|Kata sandi)$/).fill(account.password);
    await page.getByLabel(/Display name|Nama tampilan/).fill(account.displayName);
    await page.getByLabel(/Date of birth|Tanggal lahir/).fill("1992-05-04");
    await page.getByLabel(/^(Region|Wilayah)$/).selectOption({ label: r.label });
    const language = page.getByLabel(/^(Language|Bahasa)$/);
    // en-AU is the default; an Indonesian viewer picks Bahasa themselves.
    await expect(language).toHaveValue("en-AU");
    if (r.locale !== "en-AU") await language.selectOption({ label: r.language });
    await page.getByRole("button", { name: /Create account|Buat akun/ }).click();

    // Consents, per purpose: personalisation on, marketing left off.
    await expect(page).toHaveURL(/\/onboarding/);
    await page.getByRole("switch", { name: /Personalise|Personalisasi/ }).click();
    await page.getByRole("button", { name: /^(Continue|Lanjutkan)$/ }).click();

    // Interests, because personalisation is on.
    await expect(page).toHaveURL(/\/onboarding\/interests/);
    const interests = page.getByRole("checkbox");
    await interests.first().check({ force: true });
    await interests.nth(1).check({ force: true });
    await page.getByRole("button", { name: /^(Continue|Lanjutkan)$/ }).click();

    await expect(page).toHaveURL(/\/onboarding\/follow/);
    await page.getByRole("button", { name: /Continue|Skip for now|Lanjutkan|Lewati dulu/ }).first().click();
    await expect(page).toHaveURL(/\/onboarding\/done/);
    await page.getByRole("link", { name: /Start watching|Mulai menonton/ }).click();

    // Back where they started.
    await expect(page).toHaveURL(new RegExp(`/watch/${campaignId}`));

    // Verify the email through the link the app sent.
    const session = (await page.context().cookies()).find((c) => c.name === "yt_session")?.value;
    expect(session).toBeTruthy();
    await request.post(`${process.env["JOURNEY_API_URL"] ?? process.env["API_INTERNAL_URL"]}/api/auth/email/verify/request`, {
      headers: { authorization: `Bearer ${session}`, "idempotency-key": crypto.randomUUID() },
      data: {},
    });
    const token = await inboxToken(request, account.email, "email_verification");
    await page.goto(`/verify?token=${encodeURIComponent(token)}`);
    await expect(page.getByText(/verified|terverifikasi/i).first()).toBeVisible();

    // What the account holds now: the region fixed, the language chosen, the consents given.
    const me = await apiGet<{ profile: { region: string; displayLocale: string } }>(request, session ?? null, "/api/me");
    expect(me.profile.region).toBe(r.region);
    expect(me.profile.displayLocale).toBe(r.locale);
    const consents = await apiGet<{ consents: { purpose: string; granted: boolean }[] }>(
      request,
      session ?? null,
      "/api/me/consents",
    );
    const byPurpose = Object.fromEntries(consents.consents.map((c) => [c.purpose, c.granted]));
    expect(Object.values(byPurpose).some((granted) => granted)).toBe(true);
    const interestsNow = await apiGet<{ interests: unknown[] }>(request, session ?? null, "/api/me/interests");
    expect(interestsNow.interests.length).toBeGreaterThanOrEqual(1);
  });
}
