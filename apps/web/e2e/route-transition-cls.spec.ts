import type { Page } from "@playwright/test";
import { expect, test } from "@playwright/test";

/**
 * YT-0402's route-transition layout-shift acceptance criterion.
 *
 * Measures real CLS via `PerformanceObserver` on `layout-shift` entries
 * (excluding `hadRecentInput`, exactly as the CLS spec defines the metric),
 * reset before each transition so the number reported is per-transition,
 * not cumulative session noise. The gate is CLS <= 0.1 per transition.
 *
 * Transitions are driven through the real bottom nav (`nav[aria-label="Primary"]`),
 * clicking each tab in turn — Earn -> Store -> Wallet -> Quick -> Me — so this
 * exercises actual client-side Next.js navigation between the app shell's
 * five tabs, not a fresh document load each time. Waiting is done on real
 * conditions (network idle plus two animation-frame flushes so any
 * observer callback queued for the new layout has fired) rather than a
 * fixed timeout.
 */

// Starting tab is Earn ("/"), loaded before the loop below. Each entry is
// the NEXT tab clicked into, so the sequence exercised is
// Earn -> Store -> Wallet -> Quick -> Me, per the ticket's own wording
// ("Earn -> Store -> Wallet -> Me") plus Quick, since it is a fifth real tab.
const TRANSITIONS: readonly { label: string; to: string }[] = [
  { label: "Store", to: "/store" },
  { label: "Wallet", to: "/wallet" },
  { label: "Quick", to: "/quick" },
  { label: "Me", to: "/me" },
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
      .locator('nav[aria-label="Primary"]')
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
