"use client";

import { useId } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import type { Route } from "next";
import Link from "next/link";
import {
  buildStoreBoardQuery,
  hasActiveStoreFilters,
  parseStoreBoardParams,
} from "./store-board-params";
import { STORE_CATEGORY_FILTER_OPTIONS, isStoreCategoryFilter } from "./store-category";
import { STORE_PRICE_BAND_FILTER_OPTIONS, isStorePriceBandFilter } from "./store-price-band";
import { STORE_LOCATION_ALL, STORE_MERCHANT_ALL } from "./store-facets";
import type { StoreMerchantOption } from "./store-facets";

export interface StoreBoardControlsProps {
  /** Locations present in the full catalogue, not the currently-filtered subset, so narrowing one filter never hides another. */
  locationOptions: readonly string[];
  merchantOptions: readonly StoreMerchantOption[];
}

// w-full + max-w-40 (not a fixed w-40): 160px is the normal design width,
// but a fixed width can't shrink, and at 320px x 200% zoom the available
// column width after page padding is narrower than 160px — the same "fixed
// width refuses to shrink" pattern as the /business select fix. w-full lets
// it fill whatever its (min-w-0) column actually has; max-w-40 caps it at
// the normal design width everywhere else.
const SELECT_CLASS =
  "w-full max-w-40 rounded-md border border-border bg-surface px-3 py-2 text-sm font-sans text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

/**
 * The Store browse grid's four filters (YT-0420 acceptance: "category,
 * merchant, price-band and location filters"). Mirrors
 * `campaign-board-controls.tsx`: state lives in the URL, this component's
 * whole job is translating a change into a `router.push` with an updated
 * query string, and it holds no state of its own.
 *
 * All four are NATIVE `<select>` elements, not `@yourtal/ui/select`. Each
 * is an independent facet a user picks in any order (unlike the earn
 * board's kind filter, which behaves like a tab and is rendered as links)
 * — a native multi-select control set is the plain-HTML-first choice
 * docs/13b-typescript-standards.md §8 calls for, and Radix Select's
 * Popper/floating-ui weight (~30 KB gz) is not worth paying four times
 * over on a route already tight against the 170 KB budget.
 *
 * Each `<label>` is an explicit sibling of its `<select>` via `htmlFor`,
 * not a wrapper — wrapping a `<select>` in a `<label>` makes the currently
 * selected option's text part of the accessible name (the accname "name
 * from content" rule for embedded controls), which would make the name
 * drift every time the user changes the value. `campaign-board-controls.tsx`
 * uses the same explicit association for its sort control for this reason.
 */
export function StoreBoardControls({ locationOptions, merchantOptions }: StoreBoardControlsProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const categoryId = useId();
  const priceBandId = useId();
  const locationId = useId();
  const merchantId = useId();
  const current = parseStoreBoardParams(Object.fromEntries(searchParams.entries()));

  function navigate(update: Parameters<typeof buildStoreBoardQuery>[1]) {
    // typedRoutes only validates literal href strings; `pathname` is
    // request-time data, so this computed URL needs the documented `Route`
    // cast (same pattern as campaign-board-controls.tsx). Safe here: it is
    // built from `usePathname()` (the current, already-valid route) plus a
    // query string this file itself constructs.
    router.push(`${pathname}${buildStoreBoardQuery(current, update)}` as Route);
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-end gap-3">
        <div className="flex min-w-0 flex-col gap-1">
          <label htmlFor={categoryId} className="text-xs text-fg-muted">
            Kategori
          </label>
          <select
            id={categoryId}
            value={current.category}
            onChange={(event) => {
              const category = event.target.value;
              if (isStoreCategoryFilter(category)) {
                navigate({ category });
              }
            }}
            className={SELECT_CLASS}
          >
            {STORE_CATEGORY_FILTER_OPTIONS.map((option) => (
              <option key={option.key} value={option.key}>
                {option.label}
              </option>
            ))}
          </select>
        </div>

        <div className="flex min-w-0 flex-col gap-1">
          <label htmlFor={priceBandId} className="text-xs text-fg-muted">
            Harga
          </label>
          <select
            id={priceBandId}
            value={current.priceBand}
            onChange={(event) => {
              const priceBand = event.target.value;
              if (isStorePriceBandFilter(priceBand)) {
                navigate({ priceBand });
              }
            }}
            className={SELECT_CLASS}
          >
            {STORE_PRICE_BAND_FILTER_OPTIONS.map((option) => (
              <option key={option.key} value={option.key}>
                {option.label}
              </option>
            ))}
          </select>
        </div>

        <div className="flex min-w-0 flex-col gap-1">
          <label htmlFor={locationId} className="text-xs text-fg-muted">
            Lokasi
          </label>
          <select
            id={locationId}
            value={current.location}
            onChange={(event) => navigate({ location: event.target.value })}
            className={SELECT_CLASS}
          >
            <option value={STORE_LOCATION_ALL}>Semua lokasi</option>
            {locationOptions.map((district) => (
              <option key={district} value={district}>
                {district}
              </option>
            ))}
          </select>
        </div>

        <div className="flex min-w-0 flex-col gap-1">
          <label htmlFor={merchantId} className="text-xs text-fg-muted">
            Merchant
          </label>
          <select
            id={merchantId}
            value={current.merchant}
            onChange={(event) => navigate({ merchant: event.target.value })}
            className={SELECT_CLASS}
          >
            <option value={STORE_MERCHANT_ALL}>Semua merchant</option>
            {merchantOptions.map((merchant) => (
              <option key={merchant.id} value={merchant.id}>
                {merchant.name}
              </option>
            ))}
          </select>
        </div>
      </div>

      {hasActiveStoreFilters(current) ? (
        <Link
          href="/store"
          className="self-start text-xs font-medium text-primary underline-offset-2 hover:underline"
        >
          Hapus semua filter
        </Link>
      ) : null}
    </div>
  );
}
