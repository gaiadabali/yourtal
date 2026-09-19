/**
 * Turns a display name into a URL-safe slug for the public merchant route
 * (`/[locale]/m/[merchant]`, `/[locale]/rewards/[merchant]/[offerId]` —
 * docs/11-seo-aeo-geo.md §1's `/id/m/[merchant]` and
 * `/id/rewards/[merchant]/[offer]` shapes). Pure and dependency-free so it
 * can run at build time inside `generateStaticParams` without pulling
 * anything heavier in.
 *
 * Lowercases, strips diacritics (Indonesian merchant names occasionally
 * carry them, e.g. "Kopi Senja Sétiabudi"), and collapses anything that
 * is not `[a-z0-9]` into a single hyphen, trimmed at both ends.
 */
export function slugify(value: string): string {
  const withoutDiacritics = value.normalize("NFKD").replace(/[̀-ͯ]/g, "");
  return withoutDiacritics
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}
