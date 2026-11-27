"use client";

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { Section } from "@yourtal/ui/section";
import { Button } from "@yourtal/ui/button";
import { Text } from "@yourtal/ui/text";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
  DialogTrigger,
  DialogClose,
} from "@yourtal/ui/dialog";
import { deleteAccountAction } from "./me-actions";
import { withdrawGodNoticeAction } from "@/features/god-notice/god-notice-actions";

export interface MeDeleteAccountSectionProps {
  /**
   * god/TASKS.md 9.1.f: whether the viewer's data is combined with GOD, or
   * null when that could not be read. Drives the second request on this form.
   */
  inGod?: boolean | null;
}

/**
 * `DELETE /api/me` (5.4.b's real DSAR deletion — `dsar-orchestrator`
 * against Postgres handlers, which ends every session and removes the
 * profile). A real, destructive, server-side action, so this is the one
 * widget on Me that DOES gate behind a confirmation dialog and an
 * explicit checkbox — unlike every toggle above, this cannot be undone by
 * flipping it back.
 */
export function MeDeleteAccountSection({ inGod = null }: MeDeleteAccountSectionProps = {}) {
  const t = useTranslations("me.deleteAccount");
  const [confirmed, setConfirmed] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [failed, setFailed] = useState(false);

  function handleDelete() {
    setFailed(false);
    startTransition(async () => {
      // Success redirects to sign-in, so returning at all means a refusal.
      await deleteAccountAction();
      setFailed(true);
    });
  }

  return (
    <Section title={t("heading")} description={t("intro")}>
      <ul className="flex flex-col gap-2 text-body-sm text-fg-muted">
        <li>{t("bulletPoints")}</li>
        <li>{t("bulletVouchers")}</li>
        <li>{t("bulletConnectedApps")}</li>
        <li className="font-semibold text-fg">{t("bulletIrreversible")}</li>
      </ul>
      <Dialog>
        <DialogTrigger asChild>
          <Button type="button" variant="danger" className="self-start">
            {t("startCta")}
          </Button>
        </DialogTrigger>
        <DialogContent closeLabel={t("cancelCta")}>
          <DialogTitle>{t("heading")}</DialogTitle>
          <DialogDescription>{t("intro")}</DialogDescription>
          <label className="flex items-start gap-2 text-body-sm text-fg">
            {/* eslint-disable-next-line yt-b/prefer-primitives -- a one-time confirmation gesture (role="checkbox"), not @yourtal/ui's Switch (role="switch", for a persistent setting) */}
            <input
              type="checkbox"
              checked={confirmed}
              onChange={(event) => setConfirmed(event.target.checked)}
              className="mt-1"
            />
            {t("confirmCheckboxLabel")}
          </label>
          {failed ? (
            <Text size="body-sm" tone="danger" role="alert">
              {t("failed")}
            </Text>
          ) : null}
          <div className="flex justify-end gap-2">
            <DialogClose asChild>
              <Button type="button" variant="secondary">
                {t("cancelCta")}
              </Button>
            </DialogClose>
            <Button
              type="button"
              variant="danger"
              disabled={!confirmed || isPending}
              onClick={handleDelete}
            >
              {t("deleteCta")}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
      {isPending ? (
        <Text size="body-sm" tone="muted" role="status">
          …
        </Text>
      ) : null}
      <GodWithdrawRequest inGod={inGod} />
    </Section>
  );
}

/**
 * The second request type on this form (god/TASKS.md 9.1.f, founder Q4):
 * "Stop combining my data with GOD" without deleting the account. Records
 * `withdrawn`; the account itself is untouched.
 */
function GodWithdrawRequest({ inGod }: { inGod: boolean | null }) {
  const t = useTranslations("me.godWithdraw");
  const [open, setOpen] = useState(false);
  const [combined, setCombined] = useState(inGod);
  const [failed, setFailed] = useState(false);
  const [done, setDone] = useState(false);
  const [isPending, startTransition] = useTransition();

  if (combined === null) return null;

  function handleWithdraw() {
    setFailed(false);
    startTransition(async () => {
      const result = await withdrawGodNoticeAction();
      if (!result.ok) {
        setFailed(true);
        return;
      }
      setCombined(result.data.inGod);
      setDone(true);
      setOpen(false);
    });
  }

  return (
    <div className="flex flex-col gap-2 border-t border-border-subtle pt-4">
      <Text size="label">{t("heading")}</Text>
      {done ? (
        <Text size="body-sm" role="status">
          {t("done")}
        </Text>
      ) : combined ? (
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button type="button" variant="secondary" className="self-start">
              {t("startCta")}
            </Button>
          </DialogTrigger>
          <DialogContent closeLabel={t("cancelCta")}>
            <DialogTitle>{t("heading")}</DialogTitle>
            <DialogDescription>{t("body")}</DialogDescription>
            {failed ? (
              <Text size="body-sm" tone="danger" role="alert">
                {t("failed")}
              </Text>
            ) : null}
            <div className="flex justify-end gap-2">
              <DialogClose asChild>
                <Button type="button" variant="secondary">
                  {t("cancelCta")}
                </Button>
              </DialogClose>
              <Button
                type="button"
                disabled={isPending}
                loading={isPending}
                onClick={handleWithdraw}
              >
                {t("confirmCta")}
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      ) : (
        <Text size="body-sm" tone="muted">
          {t("notCombined")}
        </Text>
      )}
    </div>
  );
}
