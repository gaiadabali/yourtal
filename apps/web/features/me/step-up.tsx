"use client";

import { useState, useTransition } from "react";
import type { SubmitEvent } from "react";
import { useTranslations } from "next-intl";
import { Heading } from "@yourtal/ui/heading";
import { Input } from "@yourtal/ui/input";
import { Button } from "@yourtal/ui/button";
import { Text } from "@yourtal/ui/text";
import {
  passkeyApiCode,
  runAuthentication,
  useBrowserSupportsWebAuthn,
} from "@/features/auth/passkey-ceremony";
import { SignInAgainNotice, SignInMethodError } from "./sign-in-method-error";
import { passkeyStepUpOptionsAction, stepUpAction } from "./sign-in-methods-actions";

export interface StepUpPanelProps {
  /** The account has at least one passkey. */
  hasPasskeys: boolean;
  /** The authenticator app is on and this deployment has it switched on, so a code from it can be checked. */
  codeAvailable: boolean;
  /** The proof was accepted; the caller retries whatever the API refused. */
  onSteppedUp: () => void;
  onCancel: () => void;
}

/**
 * "Confirm it's you", shown inline when the API answers `step_up_required`: a
 * session signed in with a password alone must prove a passkey or an
 * authenticator code again before it changes sign-in methods. Offers whichever
 * of the two the account can use; with neither, the only way forward is to
 * sign in again with one. The caller retries what the API refused, so this only reports success.
 */
export function StepUpPanel({
  hasPasskeys,
  codeAvailable,
  onSteppedUp,
  onCancel,
}: StepUpPanelProps) {
  const t = useTranslations("me.signInMethods.stepUp");
  const supported = useBrowserSupportsWebAuthn();
  const [code, setCode] = useState("");
  const [errorCode, setErrorCode] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const canPasskey = hasPasskeys && supported;
  const cleanCode = code.replace(/\s+/g, "");

  function apiCode(error: { kind: string; code?: string }): string {
    return error.kind === "http" && error.code ? error.code : error.kind;
  }

  function handlePasskey() {
    setErrorCode(null);
    startTransition(async () => {
      const ceremony = await runAuthentication(passkeyStepUpOptionsAction);
      if (!ceremony.ok) {
        setErrorCode(ceremony.code);
        return;
      }
      const result = await stepUpAction({
        challengeId: ceremony.data.challengeId,
        response: ceremony.data.response,
      });
      if (!result.ok) {
        setErrorCode(passkeyApiCode(apiCode(result.error)));
        return;
      }
      onSteppedUp();
    });
  }

  function handleCode(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    setErrorCode(null);
    startTransition(async () => {
      const result = await stepUpAction({ code: cleanCode });
      if (!result.ok) {
        setErrorCode(apiCode(result.error));
        return;
      }
      onSteppedUp();
    });
  }

  if (!canPasskey && !codeAvailable) {
    return <SignInAgainNotice>{t("noFactor")}</SignInAgainNotice>;
  }

  return (
    <form
      onSubmit={handleCode}
      aria-label={t("heading")}
      className="flex flex-col gap-3 rounded-md border border-border-subtle p-4"
    >
      <Heading level={3} className="text-body font-semibold">
        {t("heading")}
      </Heading>
      <Text size="body-sm">{t("body")}</Text>
      {codeAvailable ? (
        <Input
          label={t("codeLabel")}
          inputMode="numeric"
          autoComplete="one-time-code"
          pattern="[0-9 ]*"
          maxLength={7}
          required
          value={code}
          onChange={(event) => setCode(event.target.value)}
        />
      ) : null}
      <div className="flex flex-wrap gap-2">
        {codeAvailable ? (
          <Button type="submit" disabled={isPending || cleanCode.length !== 6}>
            {t("confirmCta")}
          </Button>
        ) : null}
        {canPasskey ? (
          <Button
            type="button"
            variant={codeAvailable ? "secondary" : "primary"}
            disabled={isPending}
            onClick={handlePasskey}
          >
            {t("usePasskeyCta")}
          </Button>
        ) : null}
        <Button type="button" variant="ghost" disabled={isPending} onClick={onCancel}>
          {t("cancelCta")}
        </Button>
      </div>
      {errorCode ? <SignInMethodError code={errorCode} /> : null}
    </form>
  );
}
