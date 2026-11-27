import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { gotoSettled } from "./settle";

/**
 * Spambank's mail screens (T8) in a real browser, on the engine's in-memory client at `/lab/mail`
 * (the same screens and URL table as `/mail`, with a fixture mailbox instead of a live one).
 * Covers what jsdom cannot see: the iframe sandbox as the browser reports it, that no request
 * leaves the origin while a message with a remote image is open, the folder moves, compose, the
 * badge rising within 10 s, and axe at both widths in both themes.
 *
 * Set MAIL_SHOTS=<dir> to also write the screenshots there.
 */

const WCAG_AA = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"];
const VIEWPORTS = { "390": { width: 390, height: 844 }, "1280": { width: 1280, height: 900 } };
const SANDBOX = "allow-same-origin allow-popups allow-popups-to-escape-sandbox";
const SHOTS = process.env["MAIL_SHOTS"];

async function shot(page: Page, name: string): Promise<void> {
  if (!SHOTS) return;
  mkdirSync(SHOTS, { recursive: true });
  await page.screenshot({ path: path.join(SHOTS, `${name}.png`), fullPage: true });
}

async function violations(page: Page): Promise<string[]> {
  // The message frame is a sandbox with no scripts, so axe cannot run inside it (and it holds the
  // sender's own markup, not ours); everything around it is checked.
  const result = await new AxeBuilder({ page })
    .withTags(WCAG_AA)
    .exclude("[data-testid=mail-html-frame]")
    .analyze();
  return result.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target).join(" | ")}`);
}

const SCREENS = [
  {
    name: "inbox",
    url: "/lab/mail",
    ready: (p: Page) => p.getByText("Lunch on Friday?", { exact: true }),
  },
  { name: "spam", url: "/lab/mail/spam", ready: (p: Page) => p.getByTestId("spam-banner") },
  {
    name: "message",
    url: "/lab/mail/message/m2",
    ready: (p: Page) => p.getByTestId("mail-html-frame"),
  },
  {
    name: "compose",
    url: "/lab/mail/compose",
    ready: (p: Page) => p.getByRole("button", { name: "Send" }),
  },
] as const;

for (const colorScheme of ["light", "dark"] as const) {
  for (const [width, viewport] of Object.entries(VIEWPORTS)) {
    test.describe(`mail at ${width}px, ${colorScheme}`, () => {
      test.use({ viewport, colorScheme });

      for (const screen of SCREENS) {
        test(`${screen.name} has no axe violations`, async ({ page }) => {
          await gotoSettled(page, screen.url);
          await expect(screen.ready(page)).toBeVisible();
          expect(await violations(page)).toStrictEqual([]);
          await shot(page, `${screen.name}-${width}-${colorScheme}`);
        });
      }
    });
  }
}

test.describe("mail behaviour", () => {
  test.use({ viewport: VIEWPORTS["1280"] });

  test("an HTML message sits in a sandbox with no scripts, and nothing leaves the origin", async ({
    page,
    baseURL,
  }) => {
    const origin = new URL(baseURL ?? "http://127.0.0.1").hostname;
    const foreign: string[] = [];
    page.on("request", (request) => {
      const url = new URL(request.url());
      const local =
        url.protocol === "data:" || url.protocol === "blob:" || url.protocol === "about:";
      if (!local && url.hostname !== origin) foreign.push(request.url());
    });
    await gotoSettled(page, "/lab/mail/spam");
    await page.getByText("Urgent: verify your account").click();
    const frame = page.getByTestId("mail-html-frame");
    await expect(frame).toBeVisible();
    await expect(frame).toHaveAttribute("sandbox", SANDBOX);
    expect(await frame.getAttribute("sandbox")).not.toContain("allow-scripts");
    await expect(page.getByText(/3 remote images blocked/)).toBeVisible();
    // Nothing inside the frame can load an image from outside, and nothing outside tried to.
    const imgs = await page
      .frameLocator("[data-testid=mail-html-frame]")
      .locator("img")
      .evaluateAll((els) => els.map((el) => el.getAttribute("src") ?? ""));
    expect(imgs.filter((src) => /^https?:/i.test(src))).toStrictEqual([]);
    expect(foreign).toStrictEqual([]);
  });

  test("move to Spam and back, then Junk and Trash", async ({ page }) => {
    // Stay in the app between steps: a full page load would start a fresh fixture mailbox.
    const lunch = page.getByText("Lunch on Friday?", { exact: true });
    const rail = page.getByRole("navigation", { name: "Mail folders" });
    await gotoSettled(page, "/lab/mail");
    await lunch.click();
    await page.getByLabel("Move this message to").selectOption("spam");
    await expect(page.getByText("Moved to Spam.")).toBeVisible();
    await rail.getByRole("link", { name: /^Spam/ }).click();
    await lunch.click();
    await page.getByRole("button", { name: "Not spam" }).click();
    await expect(page.getByText(/Moved to Inbox/)).toBeVisible();
    await rail.getByRole("link", { name: /^Inbox/ }).click();
    await lunch.click();
    await page.getByLabel("Move this message to").selectOption("junk");
    await expect(page.getByText("Moved to Junk.")).toBeVisible();
    await rail.getByRole("link", { name: /^Junk/ }).click();
    await lunch.click();
    await page.getByRole("button", { name: "Delete", exact: true }).click();
    await expect(page.getByText("Moved to Trash.")).toBeVisible();
    await rail.getByRole("link", { name: /^Trash/ }).click();
    await expect(lunch).toBeVisible();
  });

  test("search finds a message by a word of its subject", async ({ page }) => {
    await gotoSettled(page, "/lab/mail");
    await expect(page.getByText("Lunch on Friday?", { exact: true })).toBeVisible();
    await page.getByRole("searchbox", { name: "Search mail" }).fill("invoice");
    await page.getByRole("searchbox", { name: "Search mail" }).press("Enter");
    await expect(page.getByText("Invoice 2026-114", { exact: true })).toBeVisible();
    await expect(page.getByText("Lunch on Friday?", { exact: true })).toHaveCount(0);
  });

  test("the Spam folder carries the YourTal banner", async ({ page }) => {
    await gotoSettled(page, "/lab/mail/spam");
    const banner = page.getByTestId("spam-banner");
    await expect(banner).toContainText("From YourTal");
    await expect(banner.getByRole("link", { name: /Advertise on YourTal/ })).toHaveAttribute(
      "href",
      "https://yourtal.gaiada.com/studio/onboarding",
    );
  });

  test("Unsubscribe on a mailing-list message says done", async ({ page }) => {
    await gotoSettled(page, "/lab/mail/junk");
    await page.getByText("This week: 40% off everything").click();
    await page.getByRole("button", { name: "Unsubscribe" }).click();
    await expect(page.getByTestId("unsubscribe-done")).toContainText("Unsubscribed.");
  });

  test("compose sends, with an attachment, and the message lands in Sent", async ({ page }) => {
    await gotoSettled(page, "/lab/mail/compose");
    await page.getByLabel("To", { exact: true }).fill("someone@example.com");
    await page.getByLabel("Subject").fill("Browser test");
    await page.getByLabel("Message", { exact: true }).fill("Hello");
    await page.getByLabel("Attach files").setInputFiles({
      name: "note.txt",
      mimeType: "text/plain",
      buffer: Buffer.from("abc"),
    });
    await expect(page.getByText("note.txt")).toBeVisible();
    await page.getByRole("button", { name: "Send" }).click();
    await expect(page).toHaveURL(/\/lab\/mail\/sent$/);
    await expect(page.getByText("Message sent.")).toBeVisible();
    await expect(page.getByText("Browser test")).toBeVisible();
  });

  test("download saves an attachment", async ({ page }) => {
    await gotoSettled(page, "/lab/mail/message/m2");
    const download = page.waitForEvent("download");
    await page.getByRole("button", { name: /Download checklist\.pdf/ }).click();
    expect((await download).suggestedFilename()).toBe("checklist.pdf");
  });

  test("the nav badge rises within 10 s of new mail", async ({ page }) => {
    await gotoSettled(page, "/lab/mail");
    const badge = page.locator('[data-testid="mail-unread-badge"]:visible').first();
    await expect(badge).toHaveText("3");
    await page.getByTestId("lab-deliver").click();
    await expect(badge).toHaveText("4", { timeout: 10_000 });
  });

  test("reads in Bahasa Indonesia when the language cookie says so", async ({
    page,
    context,
    baseURL,
  }) => {
    await context.addCookies([
      { name: "yt_locale", value: "id-ID", url: baseURL ?? "http://127.0.0.1" },
    ]);
    await gotoSettled(page, "/lab/mail");
    await expect(page.getByRole("link", { name: /^Kotak masuk/ })).toBeVisible();
    await shot(page, "inbox-id-ID-1280-light");
  });
});
