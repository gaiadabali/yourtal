import Link from "next/link";
import { Button } from "@yourtal/ui/button";
import { getDisplayLocale } from "@/i18n/get-locale";
import { getStoreTranslator } from "@/features/store/store-i18n";

/** Rendered when `getListing` finds no listing for the given id (YT-0421). */
export default async function StoreOfferNotFound() {
  const t = getStoreTranslator(await getDisplayLocale());
  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col items-center gap-3 p-10 text-center">
      <h1 className="text-lg font-semibold text-fg">{t("notFound.heading")}</h1>
      <p className="max-w-sm text-sm text-fg-muted">{t("notFound.body")}</p>
      <Button asChild variant="secondary">
        <Link href="/store">{t("notFound.cta")}</Link>
      </Button>
    </div>
  );
}
