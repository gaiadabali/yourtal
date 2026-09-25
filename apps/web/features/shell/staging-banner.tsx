import { createTranslator } from "next-intl";
import enAU from "@/messages/en-AU/shell.json";
import idID from "@/messages/id-ID/shell.json";

const CATALOGUES = { "en-AU": enAU, "id-ID": idID } as const;

export interface StagingBannerProps {
  /** BCP-47, as passed to `<html lang>`. Anything else falls back to en-AU. */
  lang: string;
}

export function StagingBanner({ lang }: StagingBannerProps) {
  const locale = lang === "id-ID" ? "id-ID" : "en-AU";
  const t = createTranslator({
    locale,
    messages: { shell: CATALOGUES[locale] },
    namespace: "shell",
  });
  // A landmark, so axe's `region` rule holds on every page it tops.
  return (
    <aside className="bg-warning text-warning-fg px-4 py-1.5 text-center text-sm font-semibold">
      {t("stagingBanner")}
    </aside>
  );
}
