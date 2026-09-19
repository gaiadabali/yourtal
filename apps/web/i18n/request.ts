import { getRequestConfig } from "next-intl/server";
import { getRegionDisplayConfig } from "@/features/region/get-region";

/**
 * next-intl's server-side request configuration (docs/15-stack-locked.md
 * line 28 locks next-intl for `id-ID`/`en-AU`; YT-0405's fourth acceptance
 * criterion is the actual copy pass this file is part of wiring up).
 *
 * The active locale is NOT derived from a URL segment (this app has no
 * `[locale]` route param — region is chosen once, via a cookie, per
 * `apps/web/features/region`) so this deliberately ignores next-intl's own
 * `requestLocale` and instead calls the region feature's own
 * `getRegionDisplayConfig()` — the exact same ambient, cookie-backed
 * resolution `app/(app)/layout.tsx` already uses for `RegionProvider`. That
 * keeps "which locale is active" a single source of truth: this file never
 * re-parses the `yourtal-region` cookie itself.
 *
 * Message catalogues are namespaced by feature (`campaign`, `quick`,
 * `store`, `wallet`, `burn`, `checkpoint` — one JSON file per feature per
 * locale under `apps/web/messages/<locale>/`), imported with a template
 * dynamic import so only the ACTIVE locale's catalogues are ever pulled
 * into a request — the inactive locale's JSON is never fetched, let alone
 * shipped to the client (bundle budget, docs/13b-typescript-standards.md
 * §8).
 */
type FeatureNamespace = "campaign" | "quick" | "store" | "wallet" | "burn" | "checkpoint";

/** A dynamic `import()` on a template-literal path resolves to `any` — this narrows it to the one shape every catalogue JSON file has. */
async function loadCatalogue(
  locale: "en-AU" | "id-ID",
  feature: FeatureNamespace,
): Promise<Record<string, unknown>> {
  const loaded = (await import(`../messages/${locale}/${feature}.json`)) as {
    default: Record<string, unknown>;
  };
  return loaded.default;
}

export default getRequestConfig(async () => {
  const { locale } = await getRegionDisplayConfig();

  const [campaign, quick, store, wallet, burn, checkpoint] = await Promise.all([
    loadCatalogue(locale, "campaign"),
    loadCatalogue(locale, "quick"),
    loadCatalogue(locale, "store"),
    loadCatalogue(locale, "wallet"),
    loadCatalogue(locale, "burn"),
    loadCatalogue(locale, "checkpoint"),
  ]);

  return {
    locale,
    messages: { campaign, quick, store, wallet, burn, checkpoint },
  };
});
