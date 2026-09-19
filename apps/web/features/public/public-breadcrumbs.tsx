import { buildBreadcrumbJsonLd, type JsonLdBreadcrumbItem } from "./public-jsonld";
import { PublicJsonLdScript } from "./public-json-ld-script";

export interface PublicBreadcrumbsProps {
  items: readonly JsonLdBreadcrumbItem[];
}

/**
 * Renders the visible breadcrumb trail AND its `BreadcrumbList` JSON-LD
 * (docs/11-seo-aeo-geo.md §5: "still a live rich result; cheap") from the
 * same list, so the two can never drift apart — a breadcrumb nav and a
 * `BreadcrumbList` built from different data would be exactly the kind of
 * markup docs/11 warns is worse than none.
 */
export function PublicBreadcrumbs({ items }: PublicBreadcrumbsProps) {
  const lastIndex = items.length - 1;
  return (
    <>
      <nav aria-label="Breadcrumb" className="text-xs text-fg-subtle">
        <ol className="flex flex-wrap items-center gap-1">
          {items.map((item, index) => (
            <li key={item.url} className="flex items-center gap-1">
              {index === lastIndex ? (
                <span aria-current="page" className="text-fg-muted">
                  {item.name}
                </span>
              ) : (
                <a href={item.url} className="hover:underline">
                  {item.name}
                </a>
              )}
              {index < lastIndex ? <span aria-hidden="true">/</span> : null}
            </li>
          ))}
        </ol>
      </nav>
      <PublicJsonLdScript data={buildBreadcrumbJsonLd(items)} />
    </>
  );
}
