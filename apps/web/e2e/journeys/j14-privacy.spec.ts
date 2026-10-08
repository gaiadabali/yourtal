import { readFile } from "node:fs/promises";
import { expect, test } from "@playwright/test";
import { API, apiGet, apiRegister, REGIONS, requireDemoEnv, testIp, useSession } from "./demo";

type Consents = { consents: { purpose: string; state: string }[] };

/**
 * Journey 14 (product-intent §2.2): from Me, a viewer grants and then
 * withdraws personalisation, downloads their data, and deletes the account,
 * after which it can no longer sign in.
 */
for (const r of REGIONS) {
  test(`J14 ${r.region}: withdraw a consent, download my data, delete my account`, async ({
    page,
    context,
    request,
    baseURL,
  }) => {
    requireDemoEnv();
    const viewer = await apiRegister(request, r, `j14-${r.slug}`);
    await useSession(context, baseURL!, viewer.token, r);
    const stateOf = async (purpose: string) =>
      (await apiGet<Consents>(request, viewer.token, "/api/me/consents")).consents.find(
        (c) => c.purpose === purpose,
      )?.state;

    await page.goto("/me");
    const personalise = page.getByRole("switch", {
      name: /^(Personalise which campaigns I see|Personalisasi kampanye yang saya lihat)$/,
    });
    await personalise.click();
    await expect(personalise).toBeChecked();
    await expect.poll(() => stateOf("declared_interest_targeting")).toBe("granted");
    await personalise.click();
    await expect(personalise).not.toBeChecked();
    await expect.poll(() => stateOf("declared_interest_targeting")).toBe("withdrawn");
    // It holds across a reload: the withdrawal is the record, not the switch.
    await page.reload();
    await expect(personalise).not.toBeChecked();

    // Their data, as a file.
    const download = page.waitForEvent("download");
    await page.getByRole("button", { name: /^(Download|Unduh)$/ }).click();
    const file = await download;
    expect(file.suggestedFilename()).toMatch(/^yourtal-data-export-\d{4}-\d{2}-\d{2}\.json$/);
    const exported = await readFile(await file.path(), "utf8");
    // Their consent history, both records, plus the account, wallet, vouchers
    // and watch sessions.
    const data = JSON.parse(exported) as {
      consents: { userId: string; purpose: string; state: string }[];
      account: { email: string; region: string; createdAt: string } | null;
      wallet: unknown[];
      vouchers: unknown[];
      watchSessions: unknown[];
    };
    expect(data.account?.email).toBe(viewer.email);
    expect(data.account?.region).toBe(r.region);
    expect(data.account?.createdAt).toBeTruthy();
    expect(Array.isArray(data.wallet)).toBe(true);
    expect(Array.isArray(data.vouchers)).toBe(true);
    expect(Array.isArray(data.watchSessions)).toBe(true);
    expect(exported).not.toMatch(/"code"|externalRef|sagaId/);
    const history = data.consents.filter((c) => c.purpose === "declared_interest_targeting");
    expect(history.map((c) => c.state).sort()).toEqual(["granted", "withdrawn"]);
    expect(history.every((c) => c.userId === viewer.userId)).toBe(true);

    // Delete, behind a confirmation.
    await page.getByRole("button", { name: /^(Delete my account|Hapus akun saya)$/ }).click();
    const dialog = page.getByRole("dialog");
    const confirm = dialog.getByRole("button", { name: /^(Delete my account|Hapus akun saya)$/ });
    await expect(confirm).toBeDisabled();
    await dialog.getByRole("checkbox").check();
    await confirm.click();
    await expect(page).toHaveURL(/\/login/, { timeout: 60_000 });

    // Gone: the old session is refused, and so is the password.
    const me = await request.get(`${API}/api/me`, {
      headers: { authorization: `Bearer ${viewer.token}` },
    });
    expect(me.status()).toBe(401);
    const login = await request.post(`${API}/api/auth/login`, {
      headers: { "x-forwarded-for": testIp() },
      data: { email: viewer.email, password: viewer.password },
    });
    expect(login.ok()).toBe(false);
  });
}
