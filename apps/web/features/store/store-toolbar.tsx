"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { Route } from "next";
import { useTranslations } from "next-intl";
import { SlidersHorizontal } from "lucide-react";
import type { ListingFacets } from "@yourtal/contracts/listing/browse";
import {
  BottomSheet,
  BottomSheetContent,
  BottomSheetFooter,
  BottomSheetHeader,
  BottomSheetTitle,
  BottomSheetTrigger,
} from "@yourtal/ui/bottom-sheet";
import { Button } from "@yourtal/ui/button";
import { Input } from "@yourtal/ui/input";
import { NativeSelect } from "@yourtal/ui/native-select";
import { StoreFilters } from "./store-filters";
import {
  activeFilterCount,
  STORE_SORTS,
  storeHref,
  withFilters,
  type StoreQuery,
} from "./store-query";

export interface StoreToolbarProps {
  query: StoreQuery;
  facets: ListingFacets;
  locations: readonly string[];
  total: number;
  base: string;
  showBrands?: boolean;
}

/** 13.15.a: search, sort, and (below lg) the filters in a bottom sheet. */
export function StoreToolbar({
  query,
  facets,
  locations,
  total,
  base,
  showBrands = true,
}: StoreToolbarProps) {
  const t = useTranslations("store.shop");
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const active = activeFilterCount(query);

  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
      <form
        className="min-w-0 flex-1"
        role="search"
        onSubmit={(event) => {
          event.preventDefault();
          const q = new FormData(event.currentTarget).get("q");
          router.push(
            storeHref(
              withFilters(query, { q: typeof q === "string" ? q.trim() : "" }),
              base,
            ) as Route,
          );
        }}
      >
        <Input
          type="search"
          name="q"
          label={t("searchLabel")}
          hideLabel
          placeholder={t("searchPlaceholder")}
          defaultValue={query.q}
        />
      </form>
      <div className="flex items-end gap-2">
        <BottomSheet open={open} onOpenChange={setOpen}>
          <BottomSheetTrigger asChild>
            <Button variant="secondary" className="gap-1.5 lg:hidden">
              <SlidersHorizontal aria-hidden="true" className="h-4 w-4" />
              {t("filters")}
              {active > 0 ? (
                <span className="rounded-pill bg-accent px-1.5 text-caption text-fg-on-accent">
                  {active}
                </span>
              ) : null}
            </Button>
          </BottomSheetTrigger>
          <BottomSheetContent closeLabel={t("close")}>
            <BottomSheetHeader>
              <BottomSheetTitle>{t("filters")}</BottomSheetTitle>
            </BottomSheetHeader>
            <div className="overflow-y-auto">
              <StoreFilters
                query={query}
                facets={facets}
                locations={locations}
                base={base}
                showBrands={showBrands}
              />
            </div>
            <BottomSheetFooter>
              <Button onClick={() => setOpen(false)}>{t("showResults", { count: total })}</Button>
            </BottomSheetFooter>
          </BottomSheetContent>
        </BottomSheet>
        <NativeSelect
          label={t("sort")}
          hideLabel
          value={query.sort}
          onChange={(event) =>
            router.push(
              storeHref(
                withFilters(query, { sort: event.target.value as StoreQuery["sort"] }),
                base,
              ) as Route,
            )
          }
          className="min-w-44"
        >
          {STORE_SORTS.map((sort) => (
            <option key={sort} value={sort}>
              {t(`sorts.${sort}`)}
            </option>
          ))}
        </NativeSelect>
      </div>
    </div>
  );
}
