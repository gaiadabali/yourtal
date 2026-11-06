"use client";

import { useTranslations } from "next-intl";
import type { InteractionDetails } from "@yourtal/contracts/oidc/interaction";
import { Button } from "@yourtal/ui/button";
import { Notice } from "@yourtal/ui/notice";
import { Text } from "@yourtal/ui/text";
import { AuthCard } from "@/features/auth/auth-card";
import { AccountLine } from "./account-line";
import { cancelAction, sendContinueAction } from "./connect-actions";
import { useConnectAction } from "./use-connect-action";

export interface ConnectSendViewProps {
  details: InteractionDetails;
}

/** `send` (docs/30 §5): the person approves SnapApp sending their deductions to another app. Nothing leaves until Send. */
export function ConnectSendView({ details }: ConnectSendViewProps) {
  const t = useTranslations("connect.send");
  const tCommon = useTranslations("connect.common");
  const { busy, failed, run } = useConnectAction();
  const { account, send, client } = details;
  if (account === null || send === null) return null;
  const to = send.to.name;
  const year = send.financialYear;

  return (
    <AuthCard title={t("heading", { year, to })}>
      <div className="flex flex-col gap-1">
        <Text>{t("signedInAs", { name: account.name })}</Text>
        <AccountLine email={account.email} disabled={busy} run={run} />
      </div>
      <Text>{t("what", { app: client.name, to, year, lines: send.lineCount })}</Text>
      <Text>{t("arrives")}</Text>
      <Text size="body-sm">
        {t("operator", { to, operator: send.to.operator })}{" "}
        {/* No referrer: this address carries the sign-in's id. */}
        <a
          href={send.to.privacyUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="text-accent underline underline-offset-4"
        >
          {tCommon("privacyLink")}
        </a>
      </Text>
      {failed ? <Notice tone="danger">{tCommon("actionFailed")}</Notice> : null}
      <div className="flex gap-3">
        <Button
          type="button"
          disabled={busy}
          onClick={() => void run(() => sendContinueAction(details.uid))}
        >
          {tCommon("sendCta")}
        </Button>
        <Button
          type="button"
          variant="secondary"
          disabled={busy}
          onClick={() => void run(() => cancelAction(details.uid))}
        >
          {tCommon("cancelCta")}
        </Button>
      </div>
    </AuthCard>
  );
}
