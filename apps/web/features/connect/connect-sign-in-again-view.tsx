"use client";

import { useTranslations } from "next-intl";
import type { InteractionDetails } from "@yourtal/contracts/oidc/interaction";
import { Button } from "@yourtal/ui/button";
import { Notice } from "@yourtal/ui/notice";
import { Text } from "@yourtal/ui/text";
import { AuthCard } from "@/features/auth/auth-card";
import { clearSessionScopedServiceWorkerCache } from "@/features/shell/clear-session-cache";
import { cancelAction, switchAccountAction } from "./connect-actions";
import { useConnectAction } from "./use-connect-action";

export interface ConnectSignInAgainViewProps {
  details: InteractionDetails;
}

/**
 * `sign_in_again`: the app asked for a newer sign-in than this session's. Signing
 * in only works signed out, so this signs the browser out of YourTal and
 * reloads, which shows the sign-in screen; the new sign-in replaces the session.
 */
export function ConnectSignInAgainView({ details }: ConnectSignInAgainViewProps) {
  const t = useTranslations("connect.signInAgain");
  const tCommon = useTranslations("connect.common");
  const { busy, failed, run } = useConnectAction();
  const app = details.client.name;

  return (
    <AuthCard title={t("heading", { app })} description={t("intro", { app })}>
      {details.account ? (
        <Text tone="muted" size="body-sm" className="break-all">
          {details.account.email}
        </Text>
      ) : null}
      {failed ? <Notice tone="danger">{tCommon("actionFailed")}</Notice> : null}
      <Button
        type="button"
        disabled={busy}
        onClick={() => {
          clearSessionScopedServiceWorkerCache();
          void run(switchAccountAction);
        }}
      >
        {t("signInCta")}
      </Button>
      <Button
        type="button"
        variant="secondary"
        disabled={busy}
        onClick={() => void run(() => cancelAction(details.uid))}
      >
        {tCommon("cancelCta")}
      </Button>
    </AuthCard>
  );
}
