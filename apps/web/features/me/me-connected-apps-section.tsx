"use client";

import { useState, useTransition } from "react";
import { useFormatter, useTranslations } from "next-intl";
import type { ConnectedApp } from "@yourtal/contracts/me/connected-app";
import { Section } from "@yourtal/ui/section";
import { Button } from "@yourtal/ui/button";
import { EmptyState } from "@yourtal/ui/empty-state";
import { Text } from "@yourtal/ui/text";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@yourtal/ui/dialog";
import { removeConnectedAppAction } from "./me-actions";

export interface MeConnectedAppsSectionProps {
  initialApps: readonly ConnectedApp[];
  isTeen: boolean;
}

/**
 * Docs/29 Y5, docs/26 §3.5: the apps this person signs in to with YourTal, each
 * with Remove. The server ends the consent (an adult's, or a teen's, which
 * also deletes their space after 30 days) and the list is then re-read.
 */
export function MeConnectedAppsSection({ initialApps, isTeen }: MeConnectedAppsSectionProps) {
  const t = useTranslations("me.connectedApps");
  const format = useFormatter();
  const [apps, setApps] = useState<readonly ConnectedApp[]>(initialApps);
  const [removing, setRemoving] = useState<ConnectedApp | null>(null);
  const [failed, setFailed] = useState(false);
  const [isPending, startTransition] = useTransition();

  function handleRemove(app: ConnectedApp) {
    setFailed(false);
    startTransition(async () => {
      const result = await removeConnectedAppAction(app.app);
      if (!result.ok) return setFailed(true);
      setApps(result.data.connectedApps);
      setRemoving(null);
    });
  }

  return (
    <Section title={t("heading")} description={t("intro")}>
      {apps.length === 0 ? (
        <EmptyState title={t("emptyTitle")} description={t("emptyBody")} />
      ) : (
        <ul className="flex flex-col gap-3">
          {apps.map((app) => (
            <li
              key={app.app}
              className="flex flex-col gap-3 rounded-card border border-border-subtle p-4 sm:flex-row sm:items-center sm:justify-between"
            >
              <div className="flex flex-col gap-1">
                <Text size="body" className="font-semibold">
                  {app.name}
                </Text>
                <Text size="body-sm" tone="muted">
                  {t("operatorLine", { operator: app.operator })}{" "}
                  {t("sinceLine", {
                    date: format.dateTime(new Date(app.grantedAt), { dateStyle: "medium" }),
                  })}{" "}
                  {t("getsLine")}
                </Text>
              </div>
              <Button
                type="button"
                variant="secondary"
                size="sm"
                aria-label={t("removeLabel", { app: app.name })}
                onClick={() => {
                  setFailed(false);
                  setRemoving(app);
                }}
              >
                {t("removeCta")}
              </Button>
            </li>
          ))}
        </ul>
      )}
      <Dialog open={removing !== null} onOpenChange={(open) => (open ? null : setRemoving(null))}>
        <DialogContent closeLabel={t("closeLabel")}>
          {removing ? (
            <>
              <DialogTitle>{t("removeTitle", { app: removing.name })}</DialogTitle>
              <DialogDescription>
                {t(isTeen ? "teenBody" : "adultBody", { app: removing.name })}
              </DialogDescription>
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
                  disabled={isPending}
                  onClick={() => handleRemove(removing)}
                >
                  {t("confirmCta")}
                </Button>
              </div>
            </>
          ) : null}
        </DialogContent>
      </Dialog>
    </Section>
  );
}
