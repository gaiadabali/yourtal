const REGIONS = [
  { href: "/au", hrefLang: "en-AU", name: "Australia", language: "English" },
  { href: "/id", hrefLang: "id-ID", name: "Indonesia", language: "Bahasa Indonesia" },
] as const;

/**
 * 11.1.a: "a crawlable region and language chooser with no IP redirect, AU
 * first." Plain anchors (no client JS, no redirect based on the request's
 * IP) — a crawler and a human see the exact same two links, in the exact
 * same order, every time.
 */
export function LandingRegionChooser() {
  return (
    <section
      aria-labelledby="region-chooser-heading"
      className="flex flex-col gap-4 p-gutter-md md:p-12"
    >
      <h2 id="region-chooser-heading" className="font-display text-headline text-fg">
        Choose your region
      </h2>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {REGIONS.map((region) => (
          <a
            key={region.href}
            href={region.href}
            hrefLang={region.hrefLang}
            className="flex flex-col gap-1 rounded-lg border border-border p-6 transition-colors hover:border-accent hover:bg-surface-raised"
          >
            <span className="text-title font-semibold text-fg">{region.name}</span>
            <span className="text-sm text-fg-muted">{region.language}</span>
          </a>
        ))}
      </div>
    </section>
  );
}
