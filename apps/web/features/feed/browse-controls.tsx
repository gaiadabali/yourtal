"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { Route } from "next";
import { useTranslations } from "next-intl";
import { SlidersHorizontal, X } from "lucide-react";
import {
  BottomSheet,
  BottomSheetContent,
  BottomSheetFooter,
  BottomSheetHeader,
  BottomSheetTitle,
  BottomSheetTrigger,
} from "@yourtal/ui/bottom-sheet";
import { Button } from "@yourtal/ui/button";
import { Chip } from "@yourtal/ui/chip";
import { cn } from "@yourtal/ui/cn";
import { browseHref, FEED_SORTS, type BrowseQuery, type FeedSort } from "./browse-query";
import type { Facet } from "./home-data";
import { useCategoryLabel } from "./use-category-label";

export interface BrowseControlsProps {
  query: BrowseQuery;
  categories: readonly Facet[];
  tags: readonly Facet[];
  /** 12.4.d/#7: teens get no "Ending soon". */
  hideEndingSoon: boolean;
}

const CHIP_LINK =
  "inline-flex h-9 shrink-0 items-center whitespace-nowrap rounded-control px-3 text-label font-sans font-semibold " +
  "transition-colors duration-(--duration-fast) ease-standard focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus";

/**
 * 13.13.b: the sticky category chips, and a sheet for topics and sort. Every
 * choice is a URL, so a reload or a shared link keeps it.
 */
export function BrowseControls({ query, categories, tags, hideEndingSoon }: BrowseControlsProps) {
  const t = useTranslations("feed.browse");
  const label = useCategoryLabel();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [draftTags, setDraftTags] = useState<readonly string[]>(query.tags);
  const [draftSort, setDraftSort] = useState<FeedSort>(query.sort);
  const sorts = FEED_SORTS.filter((sort) => !(hideEndingSoon && sort === "ending_soon"));
  const activeCount = query.tags.length + (query.sort === "for_you" ? 0 : 1);

  function go(next: BrowseQuery) {
    router.push(browseHref(next) as Route);
  }

  function onOpenChange(next: boolean) {
    if (next) {
      setDraftTags(query.tags);
      setDraftSort(query.sort);
    }
    setOpen(next);
  }

  return (
    <div className="sticky top-14 z-(--z-nav) -mx-gutter-sm flex flex-col gap-2 bg-canvas/95 px-gutter-sm py-3 backdrop-blur md:-mx-gutter-md md:px-gutter-md">
      <div className="flex items-center gap-2">
        <nav aria-label={t("chipsLabel")} className="min-w-0 flex-1">
          <ul className="flex gap-2 overflow-x-auto [scrollbar-width:none]">
            {[{ id: null as string | null, count: 0 }, ...categories].map((facet) => {
              const active = facet.id === query.category;
              return (
                <li key={facet.id ?? "all"}>
                  <a
                    href={browseHref({ category: facet.id, tags: [], sort: query.sort })}
                    aria-current={active ? "page" : undefined}
                    className={cn(
                      CHIP_LINK,
                      active
                        ? "bg-fg text-canvas"
                        : "bg-surface-sunken text-fg hover:bg-border-subtle",
                    )}
                  >
                    {facet.id === null ? t("all") : label(facet.id)}
                  </a>
                </li>
              );
            })}
          </ul>
        </nav>
        <BottomSheet open={open} onOpenChange={onOpenChange}>
          <BottomSheetTrigger asChild>
            <Button variant="secondary" size="sm" className="h-9 shrink-0 gap-1.5">
              <SlidersHorizontal aria-hidden="true" className="h-4 w-4" />
              {t("filters")}
              {activeCount > 0 ? (
                <span className="rounded-pill bg-accent px-1.5 text-caption text-fg-on-accent">
                  {activeCount}
                </span>
              ) : null}
            </Button>
          </BottomSheetTrigger>
          <BottomSheetContent
            closeLabel={t("close")}
            className="lg:inset-x-auto lg:bottom-6 lg:right-6 lg:w-[28rem] lg:rounded-sheet lg:border"
          >
            <BottomSheetHeader>
              <BottomSheetTitle>{t("filtersTitle")}</BottomSheetTitle>
            </BottomSheetHeader>
            <div className="flex flex-col gap-5 overflow-y-auto">
              <fieldset className="flex flex-col gap-2">
                <legend className="mb-2 text-label font-sans font-semibold text-fg">
                  {t("sort")}
                </legend>
                <div className="flex flex-wrap gap-2">
                  {sorts.map((sort) => (
                    <Chip
                      key={sort}
                      pressed={draftSort === sort}
                      onPressedChange={() => setDraftSort(sort)}
                    >
                      {t(`sorts.${sort}`)}
                    </Chip>
                  ))}
                </div>
              </fieldset>
              <fieldset className="flex flex-col gap-2">
                <legend className="mb-2 text-label font-sans font-semibold text-fg">
                  {t("topics")}
                </legend>
                {tags.length === 0 ? (
                  <p className="text-body-sm font-sans text-fg-muted">{t("noTopics")}</p>
                ) : (
                  <div className="flex flex-wrap gap-2">
                    {tags.map((tag) => (
                      <Chip
                        key={tag.id}
                        pressed={draftTags.includes(tag.id)}
                        onPressedChange={(pressed) =>
                          setDraftTags((current) =>
                            pressed ? [...current, tag.id] : current.filter((id) => id !== tag.id),
                          )
                        }
                      >
                        {label(tag.id)}
                        <span className="ml-1 tabular-nums opacity-70">{tag.count}</span>
                      </Chip>
                    ))}
                  </div>
                )}
              </fieldset>
            </div>
            <BottomSheetFooter className="flex-row items-center gap-2 sm:flex-row">
              <Button
                variant="ghost"
                onClick={() => {
                  setDraftTags([]);
                  setDraftSort("for_you");
                }}
              >
                {t("reset")}
              </Button>
              <Button
                className="flex-1"
                onClick={() => {
                  setOpen(false);
                  go({ category: query.category, tags: draftTags, sort: draftSort });
                }}
              >
                {t("apply")}
              </Button>
            </BottomSheetFooter>
          </BottomSheetContent>
        </BottomSheet>
      </div>
      {activeCount > 0 ? (
        <ul aria-label={t("activeFilters")} className="flex flex-wrap gap-2">
          {query.sort === "for_you" ? null : (
            <li>
              <ActiveChip
                href={browseHref({ ...query, sort: "for_you" })}
                label={t(`sorts.${query.sort}`)}
                removeLabel={t("remove", { name: t(`sorts.${query.sort}`) })}
              />
            </li>
          )}
          {query.tags.map((tag) => (
            <li key={tag}>
              <ActiveChip
                href={browseHref({ ...query, tags: query.tags.filter((id) => id !== tag) })}
                label={label(tag)}
                removeLabel={t("remove", { name: label(tag) })}
              />
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

function ActiveChip({
  href,
  label,
  removeLabel,
}: {
  href: string;
  label: string;
  removeLabel: string;
}) {
  return (
    <a
      href={href}
      aria-label={removeLabel}
      className="inline-flex h-8 items-center gap-1 rounded-pill border border-border-control px-3 text-caption font-sans font-semibold text-fg hover:bg-surface-sunken focus-visible:outline-2 focus-visible:outline-focus"
    >
      {label}
      <X aria-hidden="true" className="h-3.5 w-3.5" />
    </a>
  );
}
