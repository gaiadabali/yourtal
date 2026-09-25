import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { Page } from "@playwright/test";
import { expect, test } from "@playwright/test";
import { pinRegionCookie } from "./pin-region";

/**
 * `features/region/get-region.ts`'s `DEFAULT_REGION` was "ID"
 * (id-ID) and is now "AU" — this suite pins the region cookie to "ID"
 * below (`test.beforeEach`), found during the 0.5.d sweep for other
 * cookie-less-ID-assuming specs beyond the task's named list, since this
 * one reads the bottom nav's labels (YT-0058's nav i18n) and `aria-label`
 * out of the SAME pinned locale's catalogue file, not hardcoded English
 * strings — reading both from the same catalogue the component itself
 * renders from means this test tracks a copy change instead of silently
 * asserting a locale that no longer applies. Read via `fs`, not a bare
 * `import ... from "*.json"`: Playwright's own Node/ESM runtime rejects an
 * un-attributed JSON import ("needs an import attribute of type: json") —
 * a Next.js-loader feature, not a Node one, per
 * wallet-merchant-qr-agreement.spec.ts's identical note.
 *
 * `watch` (task 3.5.c): the second tab was relabelled from "Quick" to
 * "Watch" (href unchanged, still `/quick`) when the viewer shell moved to
 * Home · Watch · Store · Wallet · Me.
 */
interface NavCatalogue {
  primary: string;
  store: string;
  wallet: string;
  watch: string;
  me: string;
}
const idNav = JSON.parse(
  readFileSync(fileURLToPath(new URL("../messages/id-ID/nav.json", import.meta.url)), "utf-8"),
) as NavCatalogue;

test.beforeEach(async ({ context, baseURL }) => {
  await pinRegionCookie(context, "ID", baseURL!);
});

/**
 * YT-0402's route-transition layout-shift acceptance criterion.
 *
 * Measures real CLS via `PerformanceObserver` on `layout-shift` entries
 * (excluding `hadRecentInput`, exactly as the CLS spec defines the metric),
 * reset before each transition so the number reported is per-transition,
 * not cumulative session noise. The gate is CLS <= 0.1 per transition.
 *
 * Transitions are driven through the real bottom nav (`nav[aria-label=idNav.primary]`),
 * clicking each tab in turn — Home -> Store -> Wallet -> Watch -> Me — so this
 * exercises actual client-side Next.js navigation between the app shell's
 * five tabs, not a fresh document load each time. Waiting is done on real
 * conditions (network idle plus two animation-frame flushes so any
 * observer callback queued for the new layout has fired) rather than a
 * fixed timeout.
 */

// Starting tab is Home ("/"), loaded before the loop below. Each entry is
// the NEXT tab clicked into, so the sequence exercised is
// Home -> Store -> Wallet -> Watch -> Me, per the ticket's own wording
// ("Earn -> Store -> Wallet -> Me", pre-3.5.c naming) plus Watch, since it
// is a fifth real tab.
const TRANSITIONS: readonly { label: string; to: string }[] = [
  { label: idNav.store, to: "/store" },
  { label: idNav.wallet, to: "/wallet" },
  { label: idNav.watch, to: "/quick" },
  { label: idNav.me, to: "/me" },
];

async function installClsObserver(page: Page): Promise<void> {
  await page.evaluate(() => {
    const w = window as unknown as { __clsValue: number; __clsObserver?: PerformanceObserver };
    w.__clsValue = 0;
    if (w.__clsObserver) {
      return;
    }
    const observer = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        const shift = entry as PerformanceEntry & { value: number; hadRecentInput: boolean };
        if (!shift.hadRecentInput) {
          w.__clsValue += shift.value;
        }
      }
    });
    observer.observe({ type: "layout-shift", buffered: true });
    w.__clsObserver = observer;
  });
}

async function resetCls(page: Page): Promise<void> {
  await page.evaluate(() => {
    (window as unknown as { __clsValue: number }).__clsValue = 0;
  });
}

async function readCls(page: Page): Promise<number> {
  await page.waitForLoadState("networkidle");
  // Flush two frames so any layout-shift entries from the settled layout
  // have reached the PerformanceObserver callback before we read the value.
  await page.evaluate(
    () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
  );
  return page.evaluate(() => (window as unknown as { __clsValue: number }).__clsValue);
}

test("route transitions across the five tabs each stay within the CLS <= 0.1 gate", async ({
  page,
}) => {
  await page.goto("/");
  await page.waitForLoadState("networkidle");
  await installClsObserver(page);

  const results: { transition: string; cls: number }[] = [];

  for (const target of TRANSITIONS) {
    await resetCls(page);
    const link = page
      .locator(`nav[aria-label="${idNav.primary}"]`)
      .getByRole("link", { name: target.label });
    await link.click();
    await expect(page).toHaveURL(new RegExp(`${target.to.replace("/", "\\/")}$`));
    const cls = await readCls(page);
    results.push({ transition: `-> ${target.label}`, cls });
  }

  for (const result of results) {
    expect(
      result.cls,
      `transition ${result.transition} measured CLS ${result.cls}`,
    ).toBeLessThanOrEqual(0.1);
  }

  console.log("Route transition CLS:", JSON.stringify(results));
});
