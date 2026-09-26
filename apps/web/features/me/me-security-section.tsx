"use client";

import { useState } from "react";
import type { SubmitEvent } from "react";
import { useTranslations } from "next-intl";
import { Section } from "@yourtal/ui/section";
import { Input } from "@yourtal/ui/input";
import { Button } from "@yourtal/ui/button";
import { Notice } from "@yourtal/ui/notice";
import { changePasswordAction } from "./me-actions";
import { useMeActionStatus } from "./use-me-action-status";

/**
 * `POST /api/auth/password/change`, real (auth.controller.ts). On success
 * every other session for this account is revoked server-side — this
 * widget doesn't surface that beyond the success message, since there is
 * no "other sessions" list on Me yet (`GET /api/me/sessions` is watch
 * sessions, "continue watching", not auth sessions — see
 * `sessions.controller.ts`'s own doc comment).
 */
export function MeSecuritySection() {
  const t = useTranslations("me.security");
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const { status, run } = useMeActionStatus();

  function handleSubmit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    run(() => changePasswordAction(currentPassword, newPassword), () => {
      setCurrentPassword("");
      setNewPassword("");
    });
  }

  const errorMessage =
    status.kind === "error"
      ? status.code === "invalid_credentials"
        ? t("incorrectCurrentPassword")
        : status.message
      : undefined;

  return (
    <Section title={t("heading")} description={t("intro")}>
      <form onSubmit={handleSubmit} className="flex flex-col gap-3">
        <Input
          label={t("currentPasswordLabel")}
          type="password"
          autoComplete="current-password"
          required
          value={currentPassword}
          onChange={(event) => setCurrentPassword(event.target.value)}
        />
        <Input
          label={t("newPasswordLabel")}
          type="password"
          autoComplete="new-password"
          minLength={12}
          required
          helpText={t("weakPassword")}
          {...(errorMessage ? { errorMessage } : {})}
          value={newPassword}
          onChange={(event) => setNewPassword(event.target.value)}
        />
        <Button type="submit" disabled={status.kind === "pending"} className="self-start">
          {t("saveCta")}
        </Button>
        {status.kind === "success" ? (
          <Notice tone="success">{t("successMessage")}</Notice>
        ) : null}
      </form>
    </Section>
  );
}
