"use client";

import { useTranslations } from "next-intl";
import type { InteractionDetails } from "@yourtal/contracts/oidc/interaction";
import { Button } from "@yourtal/ui/button";
import { Notice } from "@yourtal/ui/notice";
import { Text } from "@yourtal/ui/text";
import { AuthCard } from "@/features/auth/auth-card";
import { AccountLine } from "./account-line";
import { AppPolicy } from "./connect-consent-view";
import { cancelAction, consentContinueAction } from "./connect-actions";
import { useConnectAction } from "./use-connect-action";

export interface ConnectTeenConsentViewProps {
  details: InteractionDetails;
  /** The guardian whose invite this is. */
  parent: string;
}

/** A teen's first sign-in to SnapApp, with their guardian's invite: who can see what, and what the app gets. */
export function ConnectTeenConsentView({ details, parent }: ConnectTeenConsentViewProps) {
  const tCommon = useTranslations("connect.common");
  const t = useTranslations("connect.teenConsent");
  const { busy, failed, run } = useConnectAction();
  const { client, account, sharing } = details;
  if (account === null) return null;
  const app = client.name;

  return (
    <AuthCard title={t("heading", { app, parent })}>
      <Text>{t("signedInAs", { name: account.name })}</Text>
      <AccountLine email={account.email} disabled={busy} run={run} />
      <Text>{t("invited", { app, parent })}</Text>
      <ul className="list-disc pl-5 font-sans text-body text-fg">
        <li>{t("parentSees", { app, parent })}</li>
        <li>{sharing?.region === "ID" ? t("getsID", { app }) : t("getsAU", { app })}</li>
        <li>{t("noPoints")}</li>
        <li>{t("parentEnds", { parent, app })}</li>
      </ul>
      <AppPolicy client={client} />
      {failed ? <Notice tone="danger">{tCommon("actionFailed")}</Notice> : null}
      <div className="flex gap-3">
        <Button
          type="button"
          disabled={busy}
          onClick={() => void run(() => consentContinueAction(details.uid))}
        >
          {tCommon("continueCta")}
        </Button>
        <Button
          type="button"
          variant="secondary"
          disabled={busy}
          onClick={() => void run(() => cancelAction(details.uid))}
        >
          {t("notNowCta")}
        </Button>
      </div>
    </AuthCard>
  );
}
