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
  // docs/26 §3.4: a teen at SnapApp hears what is wrong with the invite, when it is more than "none".
  const problem = reason === "teen_invite_required" ? details.inviteProblem : null;
  // docs/30 §5: a refused send says which check failed; "expired" is the neutral one if it were ever missing.
  const body =
    reason === "send_refused"
      ? t(`send_refused.problem.${details.sendProblem ?? "expired"}`, { app })
      : problem === null || problem === "no_invite"
        ? t(`${reason}.body`, { app })
        : t(`teen_invite_required.problem.${problem}`, { app });

  return (
    <AuthCard title={t(`${reason}.title`, { app })}>
      <Text>{body}</Text>
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
