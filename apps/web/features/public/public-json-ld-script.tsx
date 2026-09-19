export interface PublicJsonLdScriptProps {
  data: object;
}

/**
 * Renders one JSON-LD block server-side (docs/11-seo-aeo-geo.md §5: "Ship as
 * JSON-LD in a `<script type=\"application/ld+json\">` rendered
 * server-side"). Escaping `</` protects against the script tag being closed
 * early by a value that happens to contain it (a merchant or campaign title
 * pulled from mock data today, real merchant-submitted copy once a BFF
 * exists) — the standard mitigation for JSON embedded in an inline
 * `<script>`, per the OWASP XSS-prevention guidance for this exact pattern.
 * Not a client component: nothing here has state or an event handler.
 */
export function PublicJsonLdScript({ data }: PublicJsonLdScriptProps) {
  const json = JSON.stringify(data).replace(/</g, "\\u003c");
  return <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: json }} />;
}
