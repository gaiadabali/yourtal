"use client";

import { useState } from "react";
import { useFormatter, useTranslations } from "next-intl";
import type { LinkedApp } from "@yourtal/contracts/me/linked-app";
import { Section } from "@yourtal/ui/section";
import { Button } from "@yourtal/ui/button";
import { ListRow } from "@yourtal/ui/list-row";
import { Notice } from "@yourtal/ui/notice";
import { Text } from "@yourtal/ui/text";
import { issueLinkCodeAction, unlinkAppAction } from "./me-actions";
import { useMeActionStatus } from "./use-me-action-status";

export interface MeLinkedAppsSectionProps {
  initialLinkedApps: readonly LinkedApp[];
  isTeen: boolean;
}

/**
 * Me → Linked apps (5.4.c, 14.3.c). Lists the apps this account is linked
 * to, each with unlink, and issues the one-time code a partner app exchanges
 * for a lasting link. A fresh code every call by design
 * (`linked-apps.controller.ts`), so this shows the latest one it issued.
 * A teen is told why there is no code instead of being offered one that
 * would be refused (F101, F105).
 */
export function MeLinkedAppsSection({ initialLinkedApps, isTeen }: MeLinkedAppsSectionProps) {
  const t = useTranslations("me.linkedApps");
  const format = useFormatter();
  const [linkedApps, setLinkedApps] = useState<readonly LinkedApp[]>(initialLinkedApps);
  const [issued, setIssued] = useState<{ code: string; expiresAt: string } | null>(null);
  const { status, isPending, run } = useMeActionStatus();

  const appName = (partnerId: string) =>
    t.has(`apps.${partnerId}`) ? t(`apps.${partnerId}`) : partnerId;

  function handleGenerate() {
    run(
      () => issueLinkCodeAction(),
      (data) => setIssued(data),
    );
  }

  function handleUnlink(linkId: string) {
    run(
      () => unlinkAppAction(linkId),
      () => setLinkedApps((apps) => apps.filter((app) => app.linkId !== linkId)),
    );
  }

  const refusedAsTeen =
    isTeen || (status.kind === "error" && status.code === "teen_consent_not_allowed");

  return (
    <Section title={t("heading")} description={t("intro")}>
      <div className="flex flex-col gap-3">
        {linkedApps.length > 0 ? (
          <div className="flex flex-col gap-1">
            {linkedApps.map((app) => (
              <ListRow
                key={app.linkId}
                title={t("linkedTitle", { app: appName(app.partnerId) })}
                subtitle={t("linkedSince", {
                  date: format.dateTime(new Date(app.linkedAt), { dateStyle: "medium" }),
                })}
                trailing={
                  <Button
                    variant="secondary"
                    size="sm"
                    disabled={isPending}
                    onClick={() => handleUnlink(app.linkId)}
                  >
                    {t("unlinkCta")}
                  </Button>
                }
              />
            ))}
          </div>
        ) : null}

        {refusedAsTeen ? (
          <Notice tone="info">{t("teenRefused")}</Notice>
        ) : (
          <Button
            type="button"
            variant="secondary"
            onClick={handleGenerate}
            disabled={isPending}
            className="self-start"
          >
            {t("generateCta")}
          </Button>
        )}
        {issued && !refusedAsTeen ? (
          <div className="rounded-card border border-border-subtle bg-surface-sunken p-4">
            <Text size="body-sm" tone="muted">
              {t("codeLabel")}
            </Text>
            <Text size="body" numeric className="font-mono text-title tracking-widest">
              {issued.code}
            </Text>
            <Text size="caption" tone="muted">
              {t("expiresPrefix")} {new Date(issued.expiresAt).toLocaleTimeString()}
            </Text>
          </div>
        ) : null}
        {status.kind === "error" && !refusedAsTeen ? (
          <Text size="body-sm" tone="danger" role="alert">
            {t("failed")}
          </Text>
        ) : null}
      </div>
    </Section>
  );
}
