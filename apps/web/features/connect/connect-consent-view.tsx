"use client";

import { useTranslations } from "next-intl";
import type { InteractionDetails } from "@yourtal/contracts/oidc/interaction";
import { Button } from "@yourtal/ui/button";
import { Notice } from "@yourtal/ui/notice";
import { Text } from "@yourtal/ui/text";
import { AuthCard } from "@/features/auth/auth-card";
import { AccountLine } from "./account-line";
import { cancelAction, consentContinueAction, oneTapContinueAction } from "./connect-actions";
import { useConnectAction } from "./use-connect-action";

type Translate = ReturnType<typeof useTranslations>;

/** The list of what the app gets, from `sharing` (docs/26 §3.2); the date of birth is never in it. */
function sharedLines(t: Translate, sharing: NonNullable<InteractionDetails["sharing"]>): string[] {
  const has = (claim: "name" | "email" | "age_band" | "region") => sharing.claims.includes(claim);
  const lines: string[] = [];
  if (has("name") && has("email")) lines.push(t("shareNameEmail"));
  else if (has("name")) lines.push(t("shareName"));
  else if (has("email")) lines.push(t("shareEmail"));
  if (has("age_band")) lines.push(sharing.ageBand === "teen" ? t("shareTeen") : t("shareAdult"));
  if (has("region")) lines.push(sharing.region === "ID" ? t("shareRegionID") : t("shareRegionAU"));
  return lines;
}

/** "{app} is run by {operator}." / "…, not by YourTal." / "{app} isn't run by YourTal." / nothing when the operator is the app's own name. */
function operatorClause(t: Translate, client: InteractionDetails["client"]): string | null {
  const sameName = client.operator === client.name;
  if (client.externalOperator) {
    return sameName
      ? t("notRunByYourtal", { app: client.name })
      : t("runByExternal", { app: client.name, operator: client.operator });
  }
  return sameName ? null : t("runBy", { app: client.name, operator: client.operator });
}

export interface ConnectConsentViewProps {
  details: InteractionDetails;
  /** Which view this is, set by `ConnectScreen`; it decides which Continue action the button calls. */
  mode: "consent" | "continue";
}

/** The first-sign-in consent screen (`consent`) and the one-tap "Continue as" screen (`continue`). */
export function ConnectConsentView({ details, mode }: ConnectConsentViewProps) {
  const tCommon = useTranslations("connect.common");
  const t = useTranslations("connect.consent");
  const { busy, failed, run } = useConnectAction();
  const { client, account, sharing } = details;
  if (account === null) return null;
  const full = mode === "consent" && sharing !== null;
  const continueFrom = mode === "consent" ? consentContinueAction : oneTapContinueAction;
  const clause = operatorClause(t, client);

  return (
    <AuthCard title={t("heading", { app: client.name, name: account.name })}>
      <AccountLine email={account.email} disabled={busy} run={run} />
      {full ? (
        <>
          <div className="flex flex-col gap-2">
            <Text>{t("willGet", { app: client.name })}</Text>
            <ul className="list-disc pl-5 font-sans text-body text-fg">
              {sharedLines(t, sharing).map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
            <Text tone="muted" size="body-sm">
              {t("wontGet", { app: client.name })}
            </Text>
          </div>
          <div className="flex flex-col gap-2">
            <Text size="body-sm">
              {clause === null
                ? t("policyAlone", { app: client.name })
                : `${clause} ${t("policyAfterClause")}`}
            </Text>
            <Text size="body-sm" className="flex gap-4">
              {/* No referrer: this address carries the sign-in's id. */}
              <a
                href={client.privacyUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-accent underline underline-offset-4"
              >
                {t("privacyLink")}
              </a>
              <a
                href={client.termsUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-accent underline underline-offset-4"
              >
                {t("termsLink")}
              </a>
            </Text>
          </div>
          <Text tone="muted" size="body-sm">
            {t("linkedApps", { app: client.name })}
          </Text>
        </>
      ) : null}
      {failed ? <Notice tone="danger">{tCommon("actionFailed")}</Notice> : null}
      <div className="flex gap-3">
        <Button
          type="button"
          disabled={busy}
          onClick={() => void run(() => continueFrom(details.uid))}
        >
          {tCommon("continueCta")}
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
      {full ? (
        <Text tone="muted" size="body-sm">
          {tCommon("returnNote", { returnHost: client.returnHost })}
        </Text>
      ) : null}
    </AuthCard>
  );
}
