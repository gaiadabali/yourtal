"use client";

import { useState, useTransition } from "react";
import type { SubmitEvent } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import type { TotpEnrolment } from "@yourtal/contracts/identity/sign-in-methods";
import { Section } from "@yourtal/ui/section";
import { Input } from "@yourtal/ui/input";
import { Button } from "@yourtal/ui/button";
import { Badge } from "@yourtal/ui/badge";
import { Notice } from "@yourtal/ui/notice";
import { Text } from "@yourtal/ui/text";
import {
  passkeyApiCode,
  runAuthentication,
  useBrowserSupportsWebAuthn,
} from "@/features/auth/passkey-ceremony";
import { VoucherQrCode } from "@/features/wallet/voucher-qr-code";
import { SignInMethodError } from "./sign-in-method-error";
import {
  confirmTotpAction,
  disableTotpWithCodeAction,
  disableTotpWithPasskeyAction,
  passkeyStepUpOptionsAction,
  startTotpEnrolmentAction,
} from "./sign-in-methods-actions";

export interface MeAuthenticatorSectionProps {
  enabled: boolean;
  hasPasskeys: boolean;
}

type Mode = "idle" | "setup" | "turnOff";

/** The seed in groups of four, which is easier to read out and type; the QR carries it unformatted. */
function groupSecret(secret: string): string {
  return secret.replace(/\s+/g, "").replace(/(.{4})(?=.)/g, "$1 ");
}

function codeOf(error: { kind: string; code?: string }): string {
  return error.kind === "http" && error.code ? error.code : error.kind;
}

/**
 * Me → Authenticator app. Off: "Set up" asks the API for a seed, shows it as a
 * QR and as a key to type, and turns the app on only once a code from it is
 * confirmed. On: "Turn off" needs a current code, or a passkey when the
 * account has one. The seed lives only in this component's state while the QR
 * is on screen; it is never stored or logged. The status flips at once
 * (`override`) and `router.refresh()` brings the server's view in line.
 */
export function MeAuthenticatorSection({ enabled, hasPasskeys }: MeAuthenticatorSectionProps) {
  const t = useTranslations("me.authenticatorApp");
  const router = useRouter();
  const passkeysSupported = useBrowserSupportsWebAuthn();
  const [override, setOverride] = useState<boolean | null>(null);
  const [mode, setMode] = useState<Mode>("idle");
  const [enrolment, setEnrolment] = useState<TotpEnrolment | null>(null);
  const [code, setCode] = useState("");
  const [errorCode, setErrorCode] = useState<string | null>(null);
  const [done, setDone] = useState<"on" | "off" | null>(null);
  const [isPending, startTransition] = useTransition();

  const isOn = override ?? enabled;
  const cleanCode = code.replace(/\s+/g, "");

  function reset(next: Mode) {
    setMode(next);
    setEnrolment(null);
    setCode("");
    setErrorCode(null);
    setDone(null);
  }

  function handleSetUp() {
    reset("setup");
    startTransition(async () => {
      const result = await startTotpEnrolmentAction();
      if (!result.ok) {
        setMode("idle");
        setErrorCode(codeOf(result.error));
        // Another tab may have finished setting it up already.
        if (codeOf(result.error) === "totp_already_enabled") {
          setOverride(true);
          router.refresh();
        }
        return;
      }
      setEnrolment(result.data);
    });
  }

  function handleConfirm(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    setErrorCode(null);
    startTransition(async () => {
      const result = await confirmTotpAction(cleanCode);
      if (!result.ok) {
        setErrorCode(codeOf(result.error));
        return;
      }
      reset("idle");
      setOverride(true);
      setDone("on");
      router.refresh();
    });
  }

  function finishTurnOff() {
    reset("idle");
    setOverride(false);
    setDone("off");
    router.refresh();
  }

  function handleTurnOffWithCode(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    setErrorCode(null);
    startTransition(async () => {
      const result = await disableTotpWithCodeAction(cleanCode);
      if (!result.ok) {
        setErrorCode(codeOf(result.error));
        return;
      }
      finishTurnOff();
    });
  }

  function handleTurnOffWithPasskey() {
    setErrorCode(null);
    startTransition(async () => {
      const ceremony = await runAuthentication(passkeyStepUpOptionsAction);
      if (!ceremony.ok) {
        setErrorCode(ceremony.code);
        return;
      }
      const result = await disableTotpWithPasskeyAction(
        ceremony.data.challengeId,
        ceremony.data.response,
      );
      if (!result.ok) {
        setErrorCode(passkeyApiCode(codeOf(result.error)));
        return;
      }
      finishTurnOff();
    });
  }

  const codeInput = (
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
  );

  return (
    <Section title={t("heading")} description={t("intro")}>
      <div className="flex flex-col gap-4">
        <div className="flex items-center gap-2">
          <Badge variant={isOn ? "success" : "secondary"}>
            {isOn ? t("statusOn") : t("statusOff")}
          </Badge>
        </div>

        {mode === "idle" && !isOn ? (
          <Button type="button" onClick={handleSetUp} disabled={isPending} className="self-start">
            {t("setUpCta")}
          </Button>
        ) : null}

        {mode === "setup" && !enrolment ? (
          <Text size="body-sm" tone="muted" role="status">
            {t("preparing")}
          </Text>
        ) : null}

        {mode === "setup" && enrolment ? (
          <form onSubmit={handleConfirm} className="flex flex-col gap-4">
            <Text size="body-sm">{t("scanInstruction")}</Text>
            <VoucherQrCode
              payload={enrolment.otpauthUri}
              label={t("qrAlt")}
              code={groupSecret(enrolment.secret)}
              caption={t("manualKeyCaption")}
              fallbackLabel={t("qrFallback")}
            />
            {codeInput}
            <div className="flex gap-2">
              <Button type="submit" disabled={isPending || cleanCode.length !== 6}>
                {t("turnOnCta")}
              </Button>
              <Button
                type="button"
                variant="secondary"
                disabled={isPending}
                onClick={() => reset("idle")}
              >
                {t("cancelCta")}
              </Button>
            </div>
          </form>
        ) : null}

        {mode === "idle" && isOn ? (
          <Button
            type="button"
            variant="secondary"
            onClick={() => reset("turnOff")}
            disabled={isPending}
            className="self-start"
          >
            {t("turnOffCta")}
          </Button>
        ) : null}

        {mode === "turnOff" ? (
          <form onSubmit={handleTurnOffWithCode} className="flex flex-col gap-3">
            <Text size="body-sm">{t("turnOffPrompt")}</Text>
            {codeInput}
            <div className="flex flex-wrap gap-2">
              <Button type="submit" variant="danger" disabled={isPending || cleanCode.length !== 6}>
                {t("confirmTurnOffCta")}
              </Button>
              {hasPasskeys && passkeysSupported ? (
                <Button
                  type="button"
                  variant="secondary"
                  disabled={isPending}
                  onClick={handleTurnOffWithPasskey}
                >
                  {t("usePasskeyCta")}
                </Button>
              ) : null}
              <Button
                type="button"
                variant="ghost"
                disabled={isPending}
                onClick={() => reset("idle")}
              >
                {t("cancelCta")}
              </Button>
            </div>
          </form>
        ) : null}

        {errorCode ? <SignInMethodError code={errorCode} /> : null}
        {done ? (
          <Notice tone="success">{t(done === "on" ? "turnedOn" : "turnedOff")}</Notice>
        ) : null}
      </div>
    </Section>
  );
}
