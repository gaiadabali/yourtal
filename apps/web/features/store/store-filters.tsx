"use client";

import { useId, useState } from "react";
import { useRouter } from "next/navigation";
import type { Route } from "next";
import { useTranslations } from "next-intl";
import type { ListingFacets } from "@yourtal/contracts/listing/browse";
import { Button } from "@yourtal/ui/button";
import { Chip } from "@yourtal/ui/chip";
import { Input } from "@yourtal/ui/input";
import { NativeSelect } from "@yourtal/ui/native-select";
import { useCategoryLabel } from "@/features/feed/use-category-label";
import { storeHref, withFilters, type StoreQuery, type StoreWhere } from "./store-query";

export interface StoreFiltersProps {
  query: StoreQuery;
  facets: ListingFacets;
  locations: readonly string[];
  /** `/store`, or a brand page's own path. */
  base: string;
  /** A brand page has no brand filter. */
  showBrands?: boolean;
}

const BRANDS_SHOWN = 8;

function Group({ title, children }: { title: string; children: React.ReactNode }) {
  const id = useId();
  return (
    <div
      role="group"
      aria-labelledby={id}
      className="flex flex-col gap-2.5 border-t border-border-subtle pt-4 first:border-t-0 first:pt-0"
    >
      <p id={id} className="text-label font-sans font-bold text-fg">
        {title}
      </p>
      {children}
    </div>
  );
}

/**
 * 13.15.a: the shop's filters, the sidebar at 1280 and the sheet at 390.
 * Each change is a new URL, so it survives a reload and starts from page one.
 */
export function StoreFilters({
  query,
  facets,
  locations,
  base,
  showBrands = true,
}: StoreFiltersProps) {
  const t = useTranslations("store.shop");
  const label = useCategoryLabel();
  const router = useRouter();
  const [allBrands, setAllBrands] = useState(false);
  const [min, setMin] = useState(query.minPoints?.toString() ?? "");
  const [max, setMax] = useState(query.maxPoints?.toString() ?? "");

  function go(change: Partial<StoreQuery>) {
    router.push(storeHref(withFilters(query, change), base) as Route, { scroll: false });
  }

  const whereOptions: { value: StoreWhere | null; label: string }[] = [
    { value: null, label: t("whereAny") },
    { value: "in_store", label: t("whereInStore") },
    { value: "online", label: t("whereOnline") },
  ];
  const brands = allBrands ? facets.brands : facets.brands.slice(0, BRANDS_SHOWN);

  return (
    <div className="flex flex-col gap-4">
      <Group title={t("where")}>
        <div className="flex flex-wrap gap-2">
          {whereOptions.map((option) => (
            <Chip
              key={option.value ?? "any"}
              pressed={query.where === option.value}
              onPressedChange={() => go({ where: option.value })}
            >
              {option.label}
            </Chip>
          ))}
        </div>
        <p className="text-caption font-sans text-fg-subtle">{t("whereHint")}</p>
      </Group>

      <Group title={t("points")}>
        <form
          className="flex items-end gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            const toNumber = (value: string) => (/^\d{1,9}$/.test(value) ? Number(value) : null);
            go({ minPoints: toNumber(min.trim()), maxPoints: toNumber(max.trim()) });
          }}
        >
          <Input
            label={t("pointsMin")}
            inputMode="numeric"
            pattern="[0-9]*"
            value={min}
            onChange={(event) => setMin(event.target.value)}
            className="w-full"
          />
          <Input
            label={t("pointsMax")}
            inputMode="numeric"
            pattern="[0-9]*"
            value={max}
            onChange={(event) => setMax(event.target.value)}
            className="w-full"
          />
          <Button type="submit" variant="secondary" className="shrink-0">
            {t("pointsApply")}
          </Button>
        </form>
      </Group>

      {showBrands && facets.brands.length > 0 ? (
        <Group title={t("brand")}>
          <div className="flex flex-wrap gap-2">
            {brands.map((brand) => {
              const on = query.brands.includes(brand.value);
              return (
                <Chip
                  key={brand.value}
                  pressed={on}
                  onPressedChange={(pressed) =>
                    go({
                      brands: pressed
                        ? [...query.brands, brand.value]
                        : query.brands.filter((id) => id !== brand.value),
                    })
                  }
                >
                  {brand.label}
                  <span className="ml-1 tabular-nums opacity-70">{brand.count}</span>
                </Chip>
              );
            })}
          </div>
          {facets.brands.length > BRANDS_SHOWN ? (
            <Button
              variant="link"
              className="w-fit text-label"
              onClick={() => setAllBrands((value) => !value)}
            >
              {allBrands ? t("brandFewer") : t("brandAll", { count: facets.brands.length })}
            </Button>
          ) : null}
        </Group>
      ) : null}

      {facets.tags.length > 0 ? (
        <Group title={t("topics")}>
          <div className="flex flex-wrap gap-2">
            {facets.tags.map((tag) => {
              const on = query.tags.includes(tag.value);
              return (
                <Chip
                  key={tag.value}
                  pressed={on}
                  onPressedChange={(pressed) =>
                    go({
                      tags: pressed
                        ? [...query.tags, tag.value]
                        : query.tags.filter((id) => id !== tag.value),
                    })
                  }
                >
                  {label(tag.value)}
                  <span className="ml-1 tabular-nums opacity-70">{tag.count}</span>
                </Chip>
              );
            })}
          </div>
        </Group>
      ) : null}

      {locations.length > 1 || query.location ? (
        <Group title={t("location")}>
          <NativeSelect
            label={t("location")}
            hideLabel
            value={query.location ?? ""}
            onChange={(event) => go({ location: event.target.value || null })}
          >
            <option value="">{t("locationAny")}</option>
            {locations.map((district) => (
              <option key={district} value={district}>
                {district}
              </option>
            ))}
          </NativeSelect>
        </Group>
      ) : null}
    </div>
  );
}
