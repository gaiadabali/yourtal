import { useTranslations } from "next-intl";
import { EmptyState } from "@yourtal/ui/empty-state";
import type { ApiResult } from "@/lib/api/api-fetch";
import type { MeResponse } from "@/lib/api/me-schema";

/** Which notice a teen sees instead of an earning page: waiting for approval (5.13.v) or approval withdrawn (5.13.ai). */
export type GuardianNotice = "teenWaiting" | "teenWithdrawn";

/** The API refuses earning for both, so earning pages show the notice below instead. */
export function guardianNoticeFor(me: ApiResult<MeResponse>): GuardianNotice | null {
  if (!me.ok) return null;
  if (me.data.awaitingGuardian === true) return "teenWaiting";
  return me.data.guardianWithdrawn === true ? "teenWithdrawn" : null;
}

export function GuardianNoticePanel({
  notice,
  headingLevel = 2,
}: {
  notice: GuardianNotice;
  headingLevel?: 1 | 2;
}) {
  const t = useTranslations(`guardian.${notice}`);
  return (
    <div className="p-4">
      {headingLevel === 1 ? <h1 className="sr-only">{t("heading")}</h1> : null}
      <EmptyState headingLevel={2} title={t("heading")} description={t("body")} />
    </div>
  );
}
