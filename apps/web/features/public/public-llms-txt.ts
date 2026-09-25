import { getPublicTranslator } from "./public-i18n";
import { PUBLIC_INFO_SLUGS, publicInfoPage } from "./public-info-pages";
import { GENERATED_PUBLIC_LOCALES, publicLocaleConfig, publicUrl } from "./public-locale";

/** `/llms.txt` (llmstxt.org): what YourTal is, then each region's key pages in its own language. */
export function buildLlmsTxt(): string {
  const en = getPublicTranslator("en-AU");
  const lines = ["# YourTal", "", `> ${en("llms.summary")}`, "", en("llms.regions")];
  for (const locale of GENERATED_PUBLIC_LOCALES) {
    const config = publicLocaleConfig(locale);
    const t = getPublicTranslator(config.intlLocale);
    lines.push("", `## ${config.countryName}`, "");
    lines.push(
      `- [${t("catalogue.title")}](${publicUrl(locale, "/rewards")}): ${t("catalogue.description")}`,
    );
    for (const slug of PUBLIC_INFO_SLUGS) {
      const page = publicInfoPage(config.intlLocale, slug);
      lines.push(`- [${page.title}](${publicUrl(locale, `/${slug}`)}): ${page.description}`);
    }
  }
  return `${lines.join("\n")}\n`;
}
