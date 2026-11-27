"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Button } from "@yourtal/ui/button";
import { Text } from "@yourtal/ui/text";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@yourtal/ui/dialog";
import { GodNoticeTick } from "./god-notice-tick";
import { decideGodNoticeAction } from "./god-notice-actions";

export interface GodNoticePromptProps {
  readonly noticeVersion: string;
}

/**
 * The next-sign-in ask for an existing adult account (god/TASKS.md 9.1.b):
 * the same tick box, with Accept and Not now. It closes only through one of
 * the two, so a decision is always recorded; Not now records `declined` and
 * the app carries on exactly as before. Never shown to a teen.
 */
export function GodNoticePrompt({ noticeVersion }: GodNoticePromptProps) {
  const t = useTranslations("godNotice.prompt");
  const router = useRouter();
  const [open, setOpen] = useState(true);
  const [ticked, setTicked] = useState(false);
  const [failed, setFailed] = useState(false);
  const [isPending, startTransition] = useTransition();

  function decide(decision: "accepted" | "declined") {
    setFailed(false);
    startTransition(async () => {
      const result = await decideGodNoticeAction(decision, noticeVersion);
      if (!result.ok) {
        setFailed(true);
        return;
      }
      setOpen(false);
      router.refresh();
    });
  }

  return (
    <Dialog open={open}>
      <DialogContent
        hideClose
        onEscapeKeyDown={(event) => event.preventDefault()}
        onInteractOutside={(event) => event.preventDefault()}
      >
        <DialogTitle>{t("title")}</DialogTitle>
        <DialogDescription>{t("intro")}</DialogDescription>
        <GodNoticeTick checked={ticked} onCheckedChange={setTicked} />
        <Text size="body-sm" tone="muted">
          {t("notNowHint")}
        </Text>
        {failed ? (
          <Text size="body-sm" tone="danger" role="alert">
            {t("failed")}
          </Text>
        ) : null}
        <div className="flex justify-end gap-2">
          <Button
            type="button"
            variant="secondary"
            disabled={isPending}
            onClick={() => decide("declined")}
          >
            {t("notNowCta")}
          </Button>
          <Button
            type="button"
            disabled={!ticked || isPending}
            loading={isPending}
            onClick={() => decide("accepted")}
          >
            {t("acceptCta")}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
