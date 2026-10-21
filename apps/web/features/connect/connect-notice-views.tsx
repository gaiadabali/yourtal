"use client";

import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { Button } from "@yourtal/ui/button";
import { Text } from "@yourtal/ui/text";
import { AuthCard } from "@/features/auth/auth-card";
import { reloadHere } from "./connect-navigate";

/** The sign-in has ended, or belongs to another browser (404). There is nothing to do here but go back to the app. */
export function ConnectEndedView() {
  const t = useTranslations("connect.ended");
  return (
    <AuthCard title={t("heading")}>
      <Text>{t("body")}</Text>
    </AuthCard>
  );
}

/** The API could not be reached or answered something unexpected. Trying again reloads the details. */
export function ConnectUnavailableView() {
  const t = useTranslations("connect.unavailable");
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  return (
    <AuthCard title={t("heading")}>
      <Text>{t("body")}</Text>
      <Button
        type="button"
        disabled={pending}
        onClick={() => startTransition(() => router.refresh())}
      >
        {t("retryCta")}
      </Button>
    </AuthCard>
  );
}

const reloadKey = (uid: string): string => `connect-reload:${uid}`;

/**
 * The request had no interaction cookie: it was rendered inside a server action's POST, which only
 * carries the cookies of its own path. One hard navigation to the same address makes the browser
 * send the path-scoped cookie. Once per sign-in (a `sessionStorage` mark); if the cookie is still
 * missing after that, or storage is unavailable, the sign-in has ended. No cookie reaches this component.
 */
export function ConnectReloadView({ uid }: { uid: string }) {
  const t = useTranslations("connect.continuing");
  const [ended, setEnded] = useState(false);
  const started = useRef(false);
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    try {
      if (window.sessionStorage.getItem(reloadKey(uid)) === null) {
        window.sessionStorage.setItem(reloadKey(uid), "1");
        reloadHere();
        return;
      }
    } catch {
      // No storage, so no way to stop a loop: treat it as ended.
    }
    setEnded(true);
  }, [uid]);
  if (ended) return <ConnectEndedView />;
  return <AuthCard title={t("heading")}>{null}</AuthCard>;
}
