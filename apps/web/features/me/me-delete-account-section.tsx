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

/**
 * `DELETE /api/me` (5.4.b's real DSAR deletion — `dsar-orchestrator`
 * against Postgres handlers, which ends every session and removes the
 * profile). A real, destructive, server-side action, so this is the one
 * widget on Me that DOES gate behind a confirmation dialog and an
 * explicit checkbox — unlike every toggle above, this cannot be undone by
 * flipping it back.
 */
export function MeDeleteAccountSection() {
  const t = useTranslations("me.deleteAccount");
  const [confirmed, setConfirmed] = useState(false);
  const [isPending, startTransition] = useTransition();

  function handleDelete() {
    startTransition(() => {
      void deleteAccountAction();
    });
  }

  return (
    <Section title={t("heading")} description={t("intro")}>
      <ul className="flex flex-col gap-2 text-body-sm text-fg-muted">
        <li>{t("bulletPoints")}</li>
        <li>{t("bulletVouchers")}</li>
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
    </Section>
  );
}
