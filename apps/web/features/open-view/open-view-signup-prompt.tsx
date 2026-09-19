export interface OpenViewSignupPromptProps {
  heading: string;
  body: string;
  signupHref: string;
  signupCta: string;
}

/**
 * The discrete moment YT-0432's third acceptance criterion calls for —
 * shown only once `session.hasEnded` (the same trigger
 * `features/player/completion-handoff.tsx` uses for a rewarded viewer to
 * hand off to the checkpoint). For a rewarded viewer this is the point
 * they move on to be paid; for an anonymous one, this is the one
 * interstitial that names that fact and offers the one next action (sign
 * up) — never a reward claim of its own, because there is nothing here to
 * claim.
 */
export function OpenViewSignupPrompt({
  heading,
  body,
  signupHref,
  signupCta,
}: OpenViewSignupPromptProps) {
  return (
    <div
      role="status"
      aria-live="polite"
      className="flex flex-col items-center gap-3 rounded-lg border border-border bg-surface-raised p-6 text-center"
    >
      <p className="text-sm font-semibold text-fg">{heading}</p>
      <p className="text-sm text-fg-muted">{body}</p>
      <a
        href={signupHref}
        className="inline-flex h-11 items-center justify-center rounded-md bg-primary px-6 text-sm font-medium text-primary-fg transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        {signupCta}
      </a>
    </div>
  );
}
