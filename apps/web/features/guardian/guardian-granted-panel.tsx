"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@yourtal/ui/button";
import { Text } from "@yourtal/ui/text";
import { Notice } from "@yourtal/ui/notice";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
  DialogTrigger,
  DialogClose,
} from "@yourtal/ui/dialog";
import { getGuardianTranslator, type GuardianLocale } from "./guardian-i18n";
import { guardianErrorKeyFor } from "./guardian-error-copy";
import { revokeGuardianConsentAction } from "./guardian-actions";
import { GuardianDeleteAccountSection } from "./guardian-delete-account-section";

export interface GuardianGrantedPanelProps {
  token: string;
  displayName: string;
  locale: GuardianLocale;
  idempotencyKey: string;
  /** `?action=revoke` (12.2.c) — the SAME link, later, lands straight on the withdraw confirm rather than making a guardian find the button again. */
  openConfirmOnMount: boolean;
}

/**
 * The `granted` state: a confirmation, plus "Withdraw approval" behind a
 * confirm step (same shape `me-delete-account-section.tsx`'s delete
 * confirmation already uses) that explains the teen's points are held and
 * earning stops. Revoking is final for this link (12.1.a) — the confirm
 * copy says so, rather than implying a second approve could undo it.
 */
export function GuardianGrantedPanel({
  token,
  displayName,
  locale,
  idempotencyKey,
  openConfirmOnMount,
}: GuardianGrantedPanelProps) {
  const t = getGuardianTranslator(locale);
  const router = useRouter();
  const [open, setOpen] = useState(openConfirmOnMount);
  const [errorKey, setErrorKey] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function handleWithdraw() {
    setErrorKey(null);
    startTransition(async () => {
      const result = await revokeGuardianConsentAction(token, idempotencyKey);
      if (!result.ok) {
        setErrorKey(guardianErrorKeyFor(result.error));
        return;
      }
      router.refresh();
    });
  }

  return (
    <div className="flex flex-col gap-5">
      <Text tone="muted">{t("granted.body", { displayName })}</Text>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogTrigger asChild>
          <Button type="button" variant="danger" className="self-start">
            {t("granted.withdrawCta")}
          </Button>
        </DialogTrigger>
        <DialogContent closeLabel={t("granted.confirmCancelCta")}>
          <DialogTitle>{t("granted.confirmTitle")}</DialogTitle>
          <DialogDescription>{t("granted.confirmBody", { displayName })}</DialogDescription>
          {errorKey ? (
            <Notice tone="danger">{t(`granted.errors.${errorKey}`, { displayName })}</Notice>
          ) : null}
          <div className="flex justify-end gap-2">
            <DialogClose asChild>
              <Button type="button" variant="secondary">
                {t("granted.confirmCancelCta")}
              </Button>
            </DialogClose>
            <Button
              type="button"
              variant="danger"
              disabled={isPending}
              loading={isPending}
              onClick={handleWithdraw}
            >
              {t("granted.confirmWithdrawCta")}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* 12.4.b (#6): also available once granted -- a guardian may decide
          later that deletion, not just revoking, is what they want. */}
      <GuardianDeleteAccountSection
        token={token}
        displayName={displayName}
        locale={locale}
        idempotencyKey={idempotencyKey}
      />
    </div>
  );
}
