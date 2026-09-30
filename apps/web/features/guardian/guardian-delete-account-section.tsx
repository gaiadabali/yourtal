"use client";

import { useState, useTransition } from "react";
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
import { deleteGuardianAccountAction } from "./guardian-actions";

export interface GuardianDeleteAccountSectionProps {
  token: string;
  displayName: string;
  locale: GuardianLocale;
  /** Minted once by the server page (`crypto.randomUUID()`) — same "stable across a retry of this render" contract every other guardian action prop uses. */
  idempotencyKey: string;
}

/**
 * "Delete {name}'s account" (12.4.b #6) — shown in BOTH the `pending` and
 * `granted` states (`page.tsx`'s own two callers below): a guardian may
 * want this before ever approving, not only after. Runs the exact same
 * deletion the teen's own account-delete does
 * (`delete-guardian-account.use-case.ts`'s own header), gated behind a
 * confirm dialog that says what is deleted — same shape
 * `me-delete-account-section.tsx`'s own irreversible-action dialog and
 * `GuardianGrantedPanel`'s own withdraw dialog already use.
 *
 * Deliberately does NOT call `router.refresh()` on success the way
 * approve/revoke do: a refresh re-fetches `GET /api/guardian/:token`,
 * which now 404s (the token is dead the moment this succeeds) — so this
 * renders its own `deleted` state locally instead.
 */
export function GuardianDeleteAccountSection({
  token,
  displayName,
  locale,
  idempotencyKey,
}: GuardianDeleteAccountSectionProps) {
  const t = getGuardianTranslator(locale);
  const [open, setOpen] = useState(false);
  const [errorKey, setErrorKey] = useState<string | null>(null);
  const [deleted, setDeleted] = useState(false);
  const [isPending, startTransition] = useTransition();

  if (deleted) {
    return <Text tone="muted">{t("delete.deletedBody", { displayName })}</Text>;
  }

  function handleDelete() {
    setErrorKey(null);
    startTransition(async () => {
      const result = await deleteGuardianAccountAction(token, idempotencyKey);
      if (!result.ok) {
        setErrorKey(guardianErrorKeyFor(result.error));
        return;
      }
      setDeleted(true);
    });
  }

  return (
    <div className="flex flex-col gap-2">
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogTrigger asChild>
          <Button type="button" variant="danger" className="self-start">
            {t("delete.cta", { displayName })}
          </Button>
        </DialogTrigger>
        <DialogContent closeLabel={t("delete.cancelCta")}>
          <DialogTitle>{t("delete.confirmTitle", { displayName })}</DialogTitle>
          <DialogDescription>{t("delete.confirmBody", { displayName })}</DialogDescription>
          {errorKey ? (
            <Notice tone="danger">{t(`delete.errors.${errorKey}`, { displayName })}</Notice>
          ) : null}
          <div className="flex justify-end gap-2">
            <DialogClose asChild>
              <Button type="button" variant="secondary">
                {t("delete.cancelCta")}
              </Button>
            </DialogClose>
            <Button
              type="button"
              variant="danger"
              disabled={isPending}
              loading={isPending}
              onClick={handleDelete}
            >
              {t("delete.confirmCta")}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
