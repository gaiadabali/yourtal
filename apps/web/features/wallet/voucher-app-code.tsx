"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@yourtal/ui/button";
import { Notice } from "@yourtal/ui/notice";

/**
 * The code of a voucher redeemed inside a partner's app (docs/28 4.4): shown
 * to type or paste there, with Copy and no QR. `code` is undefined while it is
 * loading and null once it is known to be unavailable (offline or unreadable).
 */
export function VoucherAppCode({ code }: { code: string | null | undefined }) {
  const t = useTranslations("wallet");
  const [copied, setCopied] = useState(false);

  if (code === undefined) {
    return (
      <div
        aria-busy="true"
        className="h-control-compact w-48 animate-pulse rounded-control bg-surface-sunken"
      />
    );
  }
  if (code === null) return <Notice tone="info">{t("voucher.appCodeUnavailable")}</Notice>;

  const copy = async () => {
    try {
      // Throws where the clipboard is unavailable (an insecure origin, say).
      await navigator.clipboard.writeText(code);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };

  return (
    <div className="flex flex-col items-center gap-3">
      <span className="font-mono text-body font-semibold tracking-widest text-fg break-all text-center">
        {code}
      </span>
      <Button variant="secondary" size="sm" onClick={() => void copy()}>
        {copied ? t("voucher.appCodeCopied") : t("voucher.appCodeCopy")}
      </Button>
      <span role="status" className="sr-only">
        {copied ? t("voucher.appCodeCopied") : ""}
      </span>
    </div>
  );
}
