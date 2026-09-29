"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@yourtal/ui/button";
import { Text } from "@yourtal/ui/text";
import { Notice } from "@yourtal/ui/notice";
import { getGuardianTranslator, type GuardianLocale } from "./guardian-i18n";
import { guardianErrorKeyFor } from "./guardian-error-copy";
import { approveGuardianConsentAction } from "./guardian-actions";

export interface GuardianApproveFormProps {
  token: string;
  displayName: string;
  locale: GuardianLocale;
  /** Minted once by the server page (`crypto.randomUUID()`) — stable across a retry of this same render. */
  idempotencyKey: string;
}

/**
 * The `pending` state (12.2.c): a required checkbox — "I am 18 or over and
 * the parent or guardian of {displayName}" — gating the Approve button,
 * plus the plain-language "what they get" list the ticket's brief requires
 * (age-appropriate feed, points and rewards, a daily cap, quiet hours) and
 * the "this isn't a contract, withdraw any time with this same link"
 * notice. A successful approve calls `router.refresh()` rather than
 * managing local state for the next screen: the page re-fetches
 * `GET /api/guardian/:token` fresh on refresh, so `granted` renders from
 * the same source of truth `pending` did, not a hand-carried guess.
 */
export function GuardianApproveForm({
  token,
  displayName,
  locale,
  idempotencyKey,
}: GuardianApproveFormProps) {
  const t = getGuardianTranslator(locale);
  const router = useRouter();
  const [confirmed, setConfirmed] = useState(false);
  const [errorKey, setErrorKey] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function handleApprove() {
    setErrorKey(null);
    startTransition(async () => {
      const result = await approveGuardianConsentAction(token, idempotencyKey);
      if (!result.ok) {
        setErrorKey(guardianErrorKeyFor(result.error));
        return;
      }
      router.refresh();
    });
  }

  return (
    <div className="flex flex-col gap-5">
      <Text tone="muted">{t("pending.intro", { displayName })}</Text>

      <div className="flex flex-col gap-2">
        <Text size="label">{t("pending.whatTheyGetHeading", { displayName })}</Text>
        <ul className="flex flex-col gap-1.5 text-body-sm text-fg-muted">
          <li>{t("pending.bulletFeed")}</li>
          <li>{t("pending.bulletEarn")}</li>
          <li>{t("pending.bulletCap")}</li>
          <li>{t("pending.bulletQuietHours")}</li>
        </ul>
      </div>

      <Text size="body-sm" tone="muted">
        {t("pending.notContractNotice")}
      </Text>

      <label className="flex items-start gap-2 text-body-sm text-fg">
        {/* eslint-disable-next-line yt-b/prefer-primitives -- a one-time confirmation gesture (role="checkbox"), same reasoning `me-delete-account-section.tsx` gives for its own raw checkbox */}
        <input
          type="checkbox"
          checked={confirmed}
          onChange={(event) => setConfirmed(event.target.checked)}
          className="mt-1"
        />
        {t("pending.confirmLabel", { displayName })}
      </label>

      {errorKey ? (
        <Notice tone="danger">{t(`pending.errors.${errorKey}`, { displayName })}</Notice>
      ) : null}

      <Button
        type="button"
        disabled={!confirmed || isPending}
        loading={isPending}
        onClick={handleApprove}
      >
        {t("pending.approveCta")}
      </Button>
    </div>
  );
}
