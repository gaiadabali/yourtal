"use client";

import { useTranslations } from "next-intl";
import type { InteractionDetails } from "@yourtal/contracts/oidc/interaction";
import { Button } from "@yourtal/ui/button";
import { Notice } from "@yourtal/ui/notice";
import { Text } from "@yourtal/ui/text";
import { AuthCard } from "@/features/auth/auth-card";
import { cancelAction } from "./connect-actions";
import { useConnectAction } from "./use-connect-action";

export interface ConnectRefusedViewProps {
  details: InteractionDetails;
}

/** `refused`: why YourTal will not sign this account in to this app. The only way out is "Back to {app}", which tells the app. */
export function ConnectRefusedView({ details }: ConnectRefusedViewProps) {
  const t = useTranslations("connect.refused");
  const tCommon = useTranslations("connect.common");
  const { busy, failed, run } = useConnectAction();
  const app = details.client.name;
  // The API only sends `refused` with a reason; if one were ever missing, the neutral "on hold" wording is the safest.
  const reason = details.refusal ?? "account_on_hold";

  return (
    <AuthCard title={t(`${reason}.title`, { app })}>
      <Text>{t(`${reason}.body`, { app })}</Text>
      {failed ? <Notice tone="danger">{tCommon("actionFailed")}</Notice> : null}
      <Button
        type="button"
        disabled={busy}
        onClick={() => void run(() => cancelAction(details.uid))}
      >
        {t("backCta", { app })}
      </Button>
    </AuthCard>
  );
}
