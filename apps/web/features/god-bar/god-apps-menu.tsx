"use client";

import { useRef, useState } from "react";
import dynamic from "next/dynamic";
import type { SupportedLocale } from "@/features/shell/nav-i18n";

// The panel, its strings and the brand list load when the button is first pressed (the 200 KB gate).
// Must live in a Client Component; a Server Component's dynamic import is not code-split.
const GodAppsPanel = dynamic(() => import("./god-apps-panel"), { ssr: false });

export interface GodAppsMenuProps {
  locale: SupportedLocale;
  /** The button's accessible name, from the shell's own catalogue. */
  label: string;
  /** The same signal that shows the Mail switch: an adult who may use Spambank. */
  adult: boolean;
}

/**
 * The grid button in the header. A disclosure: `aria-expanded`, Esc closes, focus returns here.
 * Kept to the bare minimum: /me sits at the edge of the 200 KB budget.
 */
export function GodAppsMenu({ locale, label, adult }: GodAppsMenuProps) {
  const [open, setOpen] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        aria-expanded={open}
        aria-controls="god-apps"
        aria-label={label}
        onClick={() => setOpen(!open)}
        // 44 px to press; the negative margin keeps the header's width where it was.
        className="-mx-0.5 inline-flex size-11 shrink-0 items-center justify-center rounded-pill text-fg hover:bg-surface-sunken focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus"
      >
        <svg aria-hidden="true" viewBox="0 0 24 24" className="size-5" fill="currentColor">
          <path d="M4 4h4v4H4zM10 4h4v4h-4zM16 4h4v4h-4zM4 10h4v4H4zM10 10h4v4h-4zM16 10h4v4h-4zM4 16h4v4H4zM10 16h4v4h-4zM16 16h4v4h-4z" />
        </svg>
      </button>
      {open ? (
        <GodAppsPanel locale={locale} adult={adult} triggerRef={buttonRef} setOpen={setOpen} />
      ) : null}
    </>
  );
}
