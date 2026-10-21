"use client";

import { useTranslations } from "next-intl";
import { Button } from "@yourtal/ui/button";
import { Text } from "@yourtal/ui/text";
import { clearSessionScopedServiceWorkerCache } from "@/features/shell/clear-session-cache";
import { switchAccountAction } from "./connect-actions";
import type { ConnectActionResult } from "./connect-actions";

export interface AccountLineProps {
  email: string;
  disabled: boolean;
  run: (action: () => Promise<ConnectActionResult>) => Promise<void>;
}

/** "{email} · Not you? Use another account": signs this browser out of YourTal and shows the sign-in screen again. */
export function AccountLine({ email, disabled, run }: AccountLineProps) {
  const t = useTranslations("connect.common");
  return (
    <Text tone="muted" size="body-sm" className="flex flex-wrap items-center gap-x-2">
      <span className="break-all">{email}</span>
      <span aria-hidden="true">·</span>
      <span>{t("notYou")}</span>
      <Button
        type="button"
        variant="link"
        size="sm"
        disabled={disabled}
        onClick={() => {
          clearSessionScopedServiceWorkerCache();
          void run(switchAccountAction);
        }}
      >
        {t("useAnotherCta")}
      </Button>
    </Text>
  );
}
