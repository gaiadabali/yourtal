export interface OpenViewForegoneRewardBannerProps {
  eyebrow: string;
  notice: string;
  signupHref: string;
  signupLinkLabel: string;
}

/**
 * The "shown honestly during playback" half of YT-0432's second acceptance
 * criterion — a static, always-visible notice, not a ticking counter of
 * points the viewer is "missing right now" (that framing would be
 * pressure, not honesty, and this codebase's own `AccrualIndicator` copy
 * doc-comments against exactly that kind of framing for the rewarded
 * case). The inline link is a plain escape hatch for anyone who decides
 * mid-video they would rather sign up now; the discrete interstitial
 * (`OpenViewSignupPrompt`) is the one that fires at the actual payment
 * point (video end), per the third acceptance criterion.
 *
 * Not a "use client" file — it renders nothing interactive of its own
 * (the link is a plain anchor, a real full navigation out of this route,
 * matching `public-cta-link.tsx`'s own reasoning), so it stays a Server
 * Component even though its parent (`OpenViewPlayer`) is a client leaf.
 */
export function OpenViewForegoneRewardBanner({
  eyebrow,
  notice,
  signupHref,
  signupLinkLabel,
}: OpenViewForegoneRewardBannerProps) {
  return (
    <div className="flex flex-col gap-1.5 rounded-lg border border-border bg-surface-raised p-3">
      <p className="text-xs font-medium uppercase tracking-wide text-fg-subtle">{eyebrow}</p>
      <p className="text-sm text-fg-muted">{notice}</p>
      <a
        href={signupHref}
        className="text-sm font-medium text-primary underline decoration-dotted underline-offset-2"
      >
        {signupLinkLabel}
      </a>
    </div>
  );
}
