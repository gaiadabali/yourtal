"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Section } from "@yourtal/ui/section";
import { Button } from "@yourtal/ui/button";
import { Text } from "@yourtal/ui/text";
import { GodNoticeTick } from "@/features/god-notice/god-notice-tick";
import { GodTeenExplanation } from "@/features/god-notice/god-teen-explanation";
import { decideGodNoticeAction } from "@/features/god-notice/god-notice-actions";
import type { GodConsentStatus } from "@/features/god-notice/god-notice-schemas";
import { useMeActionStatus } from "./use-me-action-status";

export interface MeGodGroupSectionProps {
  initialStatus: GodConsentStatus;
}

/**
 * Where the viewer stands on the GOD Group Privacy Notice (god/TASKS.md 9.1).
 * An adult who has not agreed can do so here, with the same tick box; this is
 * an offer, not a prompt, so it never nags. A teen sees what GOD means for
 * them and whether their guardian agreed: only the guardian can. Stopping is
 * a request, under Delete your account.
 */
export function MeGodGroupSection({ initialStatus }: MeGodGroupSectionProps) {
  const t = useTranslations("me.godGroup");
  const [status, setStatus] = useState(initialStatus);
  const [ticked, setTicked] = useState(false);
  const { status: action, run } = useMeActionStatus();

  const isTeen = status.ageBand === "teen";
  const line = isTeen
    ? status.inGod
      ? t("teenGuardianAgreed")
      : t("teenNotAgreed")
    : status.inGod
      ? t("statusInGod")
      : status.current?.decision === "withdrawn"
        ? t("statusWithdrawn")
        : status.current?.decision === "declined"
          ? t("statusDeclined")
          : t("statusNone");

  function accept() {
    run(
      () => decideGodNoticeAction("accepted", status.notice.version),
      (data) => setStatus(data),
    );
  }

  return (
    <Section title={t("heading")} description={t("intro")}>
      <Text size="body-sm" role="status">
        {line}
      </Text>
      {isTeen ? <GodTeenExplanation /> : null}
      {!isTeen && !status.inGod ? (
        <div className="flex flex-col gap-3">
          <GodNoticeTick checked={ticked} onCheckedChange={setTicked} />
          <Button
            type="button"
            className="self-start"
            disabled={!ticked || action.kind === "pending"}
            loading={action.kind === "pending"}
            onClick={accept}
          >
            {t("acceptCta")}
          </Button>
          {action.kind === "error" ? (
            <Text size="body-sm" tone="danger" role="alert">
              {t("failed")}
            </Text>
          ) : null}
        </div>
      ) : null}
      {isTeen ? null : (
        <a
          href={status.notice.url}
          target="_blank"
          rel="noopener noreferrer"
          className="self-start text-body-sm text-accent underline underline-offset-4"
        >
          {t("readNotice")}
        </a>
      )}
    </Section>
  );
}
