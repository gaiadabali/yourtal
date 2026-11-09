import { useTranslations } from "next-intl";
import { EmptyState } from "@yourtal/ui/empty-state";
import type { ApiResult } from "@/lib/api/api-fetch";
import type { MeResponse } from "@/lib/api/me-schema";

/** 5.13.v: a teen whose guardian has not approved yet. The API refuses their earning, so earning pages show the notice below instead. */
export function isAwaitingGuardian(me: ApiResult<MeResponse>): boolean {
  return me.ok && me.data.awaitingGuardian === true;
}

export function AwaitingGuardianNotice({ headingLevel = 2 }: { headingLevel?: 1 | 2 }) {
  const t = useTranslations("guardian.teenWaiting");
  return (
    <div className="p-4">
      {headingLevel === 1 ? <h1 className="sr-only">{t("heading")}</h1> : null}
      <EmptyState headingLevel={2} title={t("heading")} description={t("body")} />
    </div>
  );
}
