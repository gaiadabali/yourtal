"use client";

import { useState, useTransition } from "react";
import { GOD_GROUP_NOTICE } from "@yourtal/consent/god-group-notice-constants";
import { Button } from "@yourtal/ui/button";
import { Text } from "@yourtal/ui/text";
import { getGuardianTranslator, type GuardianLocale } from "./guardian-i18n";
import { decideGuardianGodNoticeAction } from "./guardian-actions";

export interface GuardianGodNoticeTickProps {
  locale: GuardianLocale;
  checked: boolean;
  onChange: (checked: boolean) => void;
}

/**
 * The guardian's GOD Group Privacy Notice box (god/TASKS.md 9.1.c), in the
 * founder's fixed wording, unticked by default, linking to the notice's teen
 * section.
 */
export function GuardianGodNoticeTick({ locale, checked, onChange }: GuardianGodNoticeTickProps) {
  const t = getGuardianTranslator(locale);
  return (
    <label className="flex items-start gap-2 text-body-sm text-fg">
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
        className="mt-1 shrink-0"
      />
      <span>
        {t("godNotice.before")}{" "}
        <a
          href={GOD_GROUP_NOTICE.teensUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="text-accent underline underline-offset-4"
        >
          {t("godNotice.link")}
        </a>
        {t("godNotice.after")}
      </span>
    </label>
  );
}

export interface GuardianGodNoticeDecisionProps {
  token: string;
  displayName: string;
  locale: GuardianLocale;
  idempotencyKey: string;
}

/**
 * For a teen approved before the notice existed, or when its version changes:
 * the guardian accepts it or says not now. The teen keeps using YourTal
 * either way.
 */
export function GuardianGodNoticeDecision({
  token,
  displayName,
  locale,
  idempotencyKey,
}: GuardianGodNoticeDecisionProps) {
  const t = getGuardianTranslator(locale);
  const [checked, setChecked] = useState(false);
  const [outcome, setOutcome] = useState<"accepted" | "declined" | null>(null);
  const [failed, setFailed] = useState(false);
  const [isPending, startTransition] = useTransition();

  function decide(decision: "accepted" | "declined") {
    setFailed(false);
    startTransition(async () => {
      const result = await decideGuardianGodNoticeAction(token, decision, idempotencyKey);
      if (!result.ok) {
        setFailed(true);
        return;
      }
      setOutcome(result.data.decision);
    });
  }

  if (outcome !== null) {
    return (
      <Text size="body-sm" role="status">
        {outcome === "accepted"
          ? t("godNotice.accepted")
          : t("godNotice.declined", { displayName })}
      </Text>
    );
  }

  return (
    <div className="flex flex-col gap-3 rounded-card border border-border-subtle p-4">
      <Text size="label">{t("godNotice.heading")}</Text>
      <Text size="body-sm" tone="muted">
        {t("godNotice.body", { displayName })}
      </Text>
      <GuardianGodNoticeTick locale={locale} checked={checked} onChange={setChecked} />
      {failed ? (
        <Text size="body-sm" tone="danger" role="alert">
          {t("godNotice.failed")}
        </Text>
      ) : null}
      <div className="flex gap-2">
        <Button
          type="button"
          disabled={!checked || isPending}
          loading={isPending}
          onClick={() => decide("accepted")}
        >
          {t("godNotice.acceptCta")}
        </Button>
        <Button
          type="button"
          variant="secondary"
          disabled={isPending}
          onClick={() => decide("declined")}
        >
          {t("godNotice.notNowCta")}
        </Button>
      </div>
    </div>
  );
}
