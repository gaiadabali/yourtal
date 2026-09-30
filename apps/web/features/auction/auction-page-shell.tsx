import type { ReactNode } from "react";
import { getTranslations } from "next-intl/server";
import { Notice } from "@yourtal/ui/notice";
import { getMeProfile } from "@/features/me/me-data";

/**
 * 13.22.d: every auction page's frame. F86: teens take no part in auctions, so
 * a teen sees why and nothing else.
 */
export async function AuctionPageShell({ children }: { children: ReactNode }) {
  const [t, me] = await Promise.all([getTranslations("auction"), getMeProfile()]);
  const teen = me.ok && me.data.profile.ageBand === "teen";
  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-gutter-sm py-6 md:px-gutter-md">
      {teen ? <Notice tone="info">{t("teen")}</Notice> : children}
    </div>
  );
}
