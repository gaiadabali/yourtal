import { asDisplayIdr, formatMoney } from "@yourtal/contracts/money/format";
import { regionDisplayConfig } from "@/features/region/region-config";
import { commitRegionAction } from "./commit-region-action";
import { REGION_OPTIONS } from "./region-option";

/**
 * Region select (docs/tasks/phase-u-ui.md YT-0430's region criterion, added
 * at the founder's request — not in the ticket's original acceptance
 * criteria, but load-bearing: "the founder's position is that Australia is
 * the real market and Indonesia is the proving ground... chosen at
 * registration"). This is the FIRST screen of the flow, before any locale
 * is known, so — uniquely among onboarding screens — its own copy is
 * shown in both languages at once rather than switched by a locale nobody
 * has picked yet.
 *
 * A Server Component, not a "use client" leaf: each region is a real
 * `<button type="submit">` inside its own `<form action={commitRegionAction}>`
 * (a Server Action, `commit-region-action.ts`), so the whole step needs
 * zero client JS and works before any hydration — the cheapest possible
 * first screen for the 60-second signup budget. `formatMoney` is
 * dependency-free (safe anywhere); `regionDisplayConfig` is
 * `apps/web/features/region`'s client-safe mirror of the contract's
 * `REGION_CONFIG` (YT-0405) — used here too, rather than value-importing
 * `@yourtal/contracts/region` directly, so this feature has exactly one way
 * to go from `Region` to its display config, matching the client leaves
 * later in the flow (`onboarding-progress.tsx`, `phone-verification-flow.tsx`).
 */
export function RegionPicker() {
  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-2">
        <h1 className="text-2xl font-sans font-semibold text-fg">Where are you signing up from?</h1>
        <p className="text-sm font-sans text-fg-muted">Kamu mendaftar dari mana?</p>
        <p className="text-sm font-sans text-fg-muted">
          Your region sets your currency, language and consumer protections. Choose where you live —
          this can&apos;t be changed later.
        </p>
        <p className="text-sm font-sans text-fg-muted">
          Wilayahmu menentukan mata uang, bahasa, dan perlindungan konsumen yang berlaku. Pilih
          tempat kamu tinggal — tidak bisa diubah nanti.
        </p>
      </header>
      <div className="flex flex-col gap-3">
        {REGION_OPTIONS.map((option) => {
          const config = regionDisplayConfig(option.region);
          return (
            <form key={option.region} action={commitRegionAction}>
              <input type="hidden" name="region" value={option.region} />
              <button
                type="submit"
                className="flex w-full flex-col gap-1 rounded-lg border border-border bg-surface p-4 text-left transition-colors hover:border-border-strong hover:bg-surface-raised focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <span className="text-lg font-sans font-semibold text-fg">
                  {config.countryName}
                </span>
                <span className="text-sm font-sans text-fg-muted">{option.taglineEn}</span>
                <span className="text-sm font-sans text-fg-muted">{option.taglineId}</span>
                <span className="mt-2 text-xs font-sans font-medium text-fg-subtle">
                  Example reward / Contoh hadiah:{" "}
                  {formatMoney(asDisplayIdr(option.exampleAmountMinor), config.currency)}
                </span>
              </button>
            </form>
          );
        })}
      </div>
    </div>
  );
}
