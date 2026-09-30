"use client";

import { useEffect, useId, useRef, useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { Bookmark, BookmarkCheck, EllipsisVertical, EyeOff, Share2 } from "lucide-react";
import { cn } from "@yourtal/ui/cn";
import { notInterestedAction, setSavedAction } from "./feed-actions";

export interface VideoCardMenuProps {
  campaignId: string;
  title: string;
  initialSaved: boolean;
  shareUrl: string;
  onHidden: () => void;
}

const ITEM =
  "flex w-full items-center gap-3 px-3 py-2.5 text-left text-body-sm font-sans text-fg hover:bg-surface-sunken focus-visible:bg-surface-sunken focus-visible:outline-none disabled:opacity-60";

/**
 * 13.13.e: Save, Not interested and Share behind ⋮, the way YouTube does it.
 * An ARIA menu of plain actions: arrow keys move, Escape closes.
 */
export function VideoCardMenu({
  campaignId,
  title,
  initialSaved,
  shareUrl,
  onHidden,
}: VideoCardMenuProps) {
  const t = useTranslations("feed");
  const [open, setOpen] = useState(false);
  const [saved, setSaved] = useState(initialSaved);
  const [copied, setCopied] = useState(false);
  const [pending, startTransition] = useTransition();
  const menuId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    menuRef.current?.querySelector<HTMLButtonElement>("[role=menuitem]")?.focus();
    function onPointer(event: PointerEvent) {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    }
    document.addEventListener("pointerdown", onPointer);
    return () => document.removeEventListener("pointerdown", onPointer);
  }, [open]);

  function close() {
    setOpen(false);
    buttonRef.current?.focus();
  }

  function onMenuKey(event: React.KeyboardEvent) {
    const items = [
      ...(menuRef.current?.querySelectorAll<HTMLButtonElement>("[role=menuitem]") ?? []),
    ];
    const index = items.indexOf(document.activeElement as HTMLButtonElement);
    if (event.key === "Escape") {
      event.preventDefault();
      close();
    } else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const step = event.key === "ArrowDown" ? 1 : -1;
      items[(index + step + items.length) % items.length]?.focus();
    } else if (event.key === "Tab") {
      setOpen(false);
    }
  }

  function toggleSave() {
    const next = !saved;
    setSaved(next);
    startTransition(async () => {
      const result = await setSavedAction(campaignId, next);
      if (!result.ok) setSaved(!next);
    });
    close();
  }

  function hide() {
    startTransition(async () => {
      const result = await notInterestedAction(campaignId);
      if (result.ok) onHidden();
    });
    setOpen(false);
  }

  async function share() {
    // A share carries only the public page: no referral, no reward (11.4.d).
    if (typeof navigator.share === "function") {
      await navigator.share({ title, url: shareUrl }).catch(() => undefined);
    } else {
      try {
        await navigator.clipboard.writeText(shareUrl);
        setCopied(true);
      } catch {
        setCopied(false);
      }
    }
    close();
  }

  return (
    <div ref={rootRef} className="relative">
      <button
        ref={buttonRef}
        type="button"
        aria-label={t("actions.label", { title })}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={() => setOpen((value) => !value)}
        className={cn(
          "inline-flex size-9 items-center justify-center rounded-pill text-fg-muted",
          "hover:bg-surface-sunken hover:text-fg focus-visible:outline-2 focus-visible:outline-focus",
          open && "bg-surface-sunken text-fg",
        )}
      >
        <EllipsisVertical aria-hidden="true" className="h-5 w-5" />
      </button>
      {copied ? (
        <span role="status" className="sr-only">
          {t("actions.linkCopied")}
        </span>
      ) : null}
      {open ? (
        <div
          ref={menuRef}
          id={menuId}
          role="menu"
          aria-label={t("actions.label", { title })}
          onKeyDown={onMenuKey}
          className="absolute right-0 top-10 z-(--z-overlay) w-52 overflow-hidden rounded-control border border-border-subtle bg-surface-raised py-1 shadow-lg"
        >
          <button
            type="button"
            role="menuitem"
            onClick={toggleSave}
            disabled={pending}
            className={ITEM}
          >
            {saved ? (
              <BookmarkCheck aria-hidden="true" className="h-5 w-5 text-accent" />
            ) : (
              <Bookmark aria-hidden="true" className="h-5 w-5 text-fg-muted" />
            )}
            {saved ? t("actions.unsave") : t("actions.save")}
          </button>
          <button type="button" role="menuitem" onClick={hide} disabled={pending} className={ITEM}>
            <EyeOff aria-hidden="true" className="h-5 w-5 text-fg-muted" />
            {t("actions.notInterested")}
          </button>
          <button type="button" role="menuitem" onClick={() => void share()} className={ITEM}>
            <Share2 aria-hidden="true" className="h-5 w-5 text-fg-muted" />
            {t("actions.share")}
          </button>
        </div>
      ) : null}
    </div>
  );
}
