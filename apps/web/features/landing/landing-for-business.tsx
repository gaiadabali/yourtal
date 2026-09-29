/**
 * 11.1.a: "a 'for businesses' section, following the Phase 3 copy rules."
 * Red line 5 (docs/21 §8): no unevidenced ROI or redemption-rate claim —
 * this describes the mechanism honestly (a video, a real viewer, a real
 * voucher redeemed at the till) and leaves every number out, rather than
 * inventing one to sound persuasive.
 */
export function LandingForBusiness() {
  return (
    <section
      aria-labelledby="for-business-heading"
      className="flex flex-col gap-4 border-t border-border-subtle bg-surface p-gutter-md md:p-12"
    >
      <h2 id="for-business-heading" className="font-display text-headline text-fg">
        For businesses
      </h2>
      <p className="max-w-2xl text-sm text-fg-muted">
        Run a short video about your business — what you sell, what makes you worth a visit. A
        viewer watches it, answers a question or two honestly, and earns points they spend on a
        voucher at your counter. You set the budget and the voucher; you never pay for a view that
        was not watched.
      </p>
      <a
        href="/studio"
        className="inline-flex h-11 w-fit items-center justify-center rounded-md bg-primary px-6 text-sm font-medium text-primary-fg transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        Set up your business
      </a>
    </section>
  );
}
