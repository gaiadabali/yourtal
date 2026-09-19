"use client";

import { cn } from "@yourtal/ui/cn";

export interface MeConsentToggleProps {
  id: string;
  title: string;
  body: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}

/**
 * One consent purpose, one switch — `role="switch"`/`aria-checked` rather
 * than a checkbox, since this is live account state a user flips at will
 * (not a form field submitted once), matching the ARIA switch pattern.
 * `aria-labelledby` points at the purpose's own title, so the accessible
 * name is exactly what's printed on screen; `aria-checked` is how
 * assistive tech announces on/off — that is the whole state, no extra
 * "turn on"/"turn off" wording layered on top of it.
 *
 * The whole point of "toggles that visibly take effect" is that granting
 * and withdrawing are the same gesture: one click, immediate `onChange`,
 * no confirmation dialog either way. Do not add one here even for
 * withdrawal — see this component's caller (`me-consent-section.tsx`) for
 * where the visible effect is rendered.
 */
export function MeConsentToggle({ id, title, body, checked, onChange }: MeConsentToggleProps) {
  return (
    <div className="flex items-start justify-between gap-4 rounded-lg border border-border bg-surface p-4">
      <div className="flex flex-col gap-1">
        <span id={`${id}-title`} className="text-sm font-sans font-semibold text-fg">
          {title}
        </span>
        <span className="text-sm font-sans text-fg-muted">{body}</span>
      </div>
      <button
        type="button"
        role="switch"
        id={id}
        aria-checked={checked}
        aria-labelledby={`${id}-title`}
        onClick={() => onChange(!checked)}
        className={cn(
          "relative inline-flex h-7 w-12 shrink-0 items-center rounded-full transition-colors",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
          checked ? "bg-primary" : "bg-surface-raised border border-border-strong",
        )}
      >
        <span
          aria-hidden="true"
          className={cn(
            "inline-block h-5 w-5 transform rounded-full bg-primary-fg shadow transition-transform",
            checked ? "translate-x-6" : "translate-x-1",
          )}
        />
      </button>
    </div>
  );
}
