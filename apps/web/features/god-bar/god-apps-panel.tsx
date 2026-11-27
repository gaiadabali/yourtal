"use client";

import { useEffect, useRef, type KeyboardEvent, type RefObject } from "react";
import Link from "next/link";
import type { SupportedLocale } from "@/features/shell/nav-i18n";
import { BRAND_ICONS, CURRENT_BRAND, GOD_BRANDS, type GodBrand } from "./brands";
import { getGodBarTranslator } from "./god-bar-i18n";
import { GOD } from "./god";

export interface GodAppsPanelProps {
  locale: SupportedLocale;
  /** Shows the adults-only brands (Spambank). False for a teen, a visitor, or when Mail is off. */
  adult: boolean;
  triggerRef: RefObject<HTMLButtonElement | null>;
  setOpen: (open: boolean) => void;
}

const TILE =
  "flex min-h-11 items-center gap-3 rounded-control px-3 py-2 text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus";

function Tile({
  brand,
  purpose,
  current,
  currentLabel,
  onClose,
}: {
  brand: GodBrand;
  purpose: string;
  current: boolean;
  currentLabel: string;
  onClose: () => void;
}) {
  const body = (
    <>
      <img
        src={BRAND_ICONS[brand.key]}
        alt=""
        width={40}
        height={40}
        className="size-10 shrink-0 rounded-control bg-surface-sunken object-contain p-1"
      />
      <span className="flex min-w-0 flex-col">
        <span className="text-body-sm font-bold">{brand.name}</span>
        <span className="text-caption text-fg-muted">{current ? currentLabel : purpose}</span>
      </span>
    </>
  );
  // The app you are in: marked, not a link.
  if (current) {
    return (
      <div aria-current="true" className={`${TILE} bg-accent-subtle`}>
        {body}
      </div>
    );
  }
  if (brand.inApp === "mail") {
    return (
      <Link href="/mail" onClick={onClose} className={`${TILE} hover:bg-surface-sunken`}>
        {body}
      </Link>
    );
  }
  return (
    <a href={brand.appUrl ?? brand.url} className={`${TILE} hover:bg-surface-sunken`}>
      {body}
    </a>
  );
}

/**
 * The switcher's panel, loaded on demand. Moves focus to the first tile, keeps Tab inside, closes on
 * Esc (focus goes back to the button) or a press outside. Plain links: no tracking, no tokens.
 */
export default function GodAppsPanel({ locale, adult, triggerRef, setOpen }: GodAppsPanelProps) {
  const t = getGodBarTranslator(locale);
  const rootRef = useRef<HTMLDivElement>(null);
  const brands = GOD_BRANDS.filter((brand) => !brand.adultsOnly || adult);

  useEffect(() => {
    const root = rootRef.current;
    root?.querySelector<HTMLElement>("a")?.focus();
    function onPointer(event: PointerEvent) {
      const target = event.target as Node;
      if (root?.contains(target) || triggerRef.current?.contains(target)) return;
      setOpen(false);
    }
    document.addEventListener("pointerdown", onPointer);
    return () => document.removeEventListener("pointerdown", onPointer);
  }, [setOpen, triggerRef]);

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === "Escape") {
      event.stopPropagation();
      setOpen(false);
      triggerRef.current?.focus();
      return;
    }
    if (event.key !== "Tab") return;
    const items = [...(rootRef.current?.querySelectorAll<HTMLElement>("a[href]") ?? [])];
    const first = items[0];
    const last = items[items.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last?.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first?.focus();
    }
  }

  return (
    <div
      ref={rootRef}
      id="god-apps"
      role="dialog"
      aria-label={t("title")}
      onKeyDown={onKeyDown}
      className="absolute right-2 top-full z-(--z-overlay) mt-1 w-[min(20rem,calc(100vw-1rem))] rounded-card border border-border-subtle bg-surface-raised p-2 shadow-lg"
    >
      <ul className="flex flex-col gap-1">
        {brands.map((brand) => (
          <li key={brand.key}>
            <Tile
              brand={brand}
              purpose={t(`brands.${brand.key}`)}
              current={brand.key === CURRENT_BRAND}
              currentLabel={t("current")}
              onClose={() => setOpen(false)}
            />
          </li>
        ))}
      </ul>
      <div className="mt-1 border-t border-border-subtle pt-1">
        <a
          href={GOD.url}
          className="flex min-h-11 items-center rounded-control px-3 text-body-sm font-medium text-fg hover:bg-surface-sunken focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus"
        >
          {t("about")}
        </a>
      </div>
    </div>
  );
}
