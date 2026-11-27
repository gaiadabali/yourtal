import { getNavTranslator, type SupportedLocale } from "@/features/shell/nav-i18n";
import { GOD } from "./god";

/** "A GOD company": the link back to god.gaiada.com at the foot of every app page. No tracking parameters. */
export function GodCompanyFooter({ locale }: { locale: SupportedLocale }) {
  return (
    <footer className="px-gutter-sm py-4 text-center text-body-sm text-fg-muted md:px-gutter-md">
      <a
        href={GOD.url}
        className="inline-flex min-h-11 items-center rounded-control px-2 underline-offset-4 hover:text-fg hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus"
      >
        {getNavTranslator(locale)("godCompany")}
      </a>
    </footer>
  );
}
