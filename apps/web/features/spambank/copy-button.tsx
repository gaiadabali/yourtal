"use client";

import { useEffect, useRef, useState } from "react";
import { Check, Copy } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@yourtal/ui/button";

/** Copies text, says so for two seconds, and falls back quietly where the clipboard is blocked. */
export function CopyButton({ text, label }: { text: string; label: string }) {
  const t = useTranslations("spambank.common");
  const [done, setDone] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setDone(true);
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => setDone(false), 2000);
    } catch {
      // Clipboard blocked: the text is on screen to select by hand.
    }
  };

  return (
    <>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        aria-label={label}
        onClick={() => void copy()}
        className="size-8 shrink-0"
      >
        {done ? (
          <Check aria-hidden="true" className="size-4" />
        ) : (
          <Copy aria-hidden="true" className="size-4" />
        )}
      </Button>
      <span role="status" className="sr-only">
        {done ? t("copied") : ""}
      </span>
    </>
  );
}
