"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useTranslations } from "next-intl";
import type { MailboxQuota } from "@yourtal/contracts/spambank/management";
import { Button } from "@yourtal/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogTitle,
  DialogTrigger,
} from "@yourtal/ui/dialog";
import { Heading } from "@yourtal/ui/heading";
import { Progress } from "@yourtal/ui/progress";
import { Section } from "@yourtal/ui/section";
import { Text } from "@yourtal/ui/text";
import { AppPasswords } from "./app-passwords";
import { CopyButton } from "./copy-button";
import { fileSize } from "./mail-format";
import { useMailLocale } from "./mail-ui";
import { deleteMailboxAction } from "./spambank-actions";

/** "Delete my mailbox only": the same path as account deletion, for the mailbox alone. */
function DeleteMailbox() {
  const t = useTranslations("spambank.deleteMailbox");
  const router = useRouter();
  const [confirmed, setConfirmed] = useState(false);
  const [pending, setPending] = useState(false);
  const [failed, setFailed] = useState(false);
  const [open, setOpen] = useState(false);

  async function remove() {
    setPending(true);
    setFailed(false);
    const result = await deleteMailboxAction().catch(() => null);
    setPending(false);
    if (!result?.ok) return setFailed(true);
    setOpen(false);
    router.refresh();
  }

  return (
    <div className="flex flex-col gap-2">
      <Heading level={3} size="title">
        {t("heading")}
      </Heading>
      <Text size="body-sm" tone="muted">
        {t("intro")}
      </Text>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogTrigger asChild>
          <Button type="button" variant="danger" className="self-start">
            {t("start")}
          </Button>
        </DialogTrigger>
        <DialogContent closeLabel={t("cancel")}>
          <DialogTitle>{t("heading")}</DialogTitle>
          <DialogDescription>{t("warning")}</DialogDescription>
          <label className="flex items-start gap-2 text-body-sm font-sans text-fg">
            <input
              type="checkbox"
              checked={confirmed}
              onChange={(e) => setConfirmed(e.target.checked)}
              className="mt-1"
            />
            {t("confirm")}
          </label>
          {failed ? (
            <Text size="body-sm" tone="danger" role="alert">
              {t("failed")}
            </Text>
          ) : null}
          <div className="flex justify-end gap-2">
            <DialogClose asChild>
              <Button type="button" variant="secondary">
                {t("cancel")}
              </Button>
            </DialogClose>
            <Button
              type="button"
              variant="danger"
              disabled={!confirmed || pending}
              onClick={() => void remove()}
            >
              {pending ? t("deleting") : t("delete")}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

/**
 * The mail part of Me (`/me#mail`): the address and storage, app passwords for a phone's mail app,
 * and deleting the mailbox. With no mailbox yet it points to the switch-on screen instead.
 */
export function MeMailSection({
  address,
  quota,
}: {
  /** `null` when mail is not switched on yet. */
  address: string | null;
  quota?: MailboxQuota | undefined;
}) {
  const t = useTranslations("spambank.settings");
  const locale = useMailLocale();
  if (address === null) {
    return (
      <Section id="mail" title={t("heading")} description={t("introOff")}>
        <Button asChild className="self-start">
          <Link href="/mail">{t("getInbox")}</Link>
        </Button>
      </Section>
    );
  }
  const usedPct =
    quota && quota.limitBytes > 0
      ? Math.min(100, Math.round((quota.usedBytes / quota.limitBytes) * 100))
      : 0;
  return (
    <Section id="mail" title={t("heading")} description={t("intro")}>
      <div className="flex flex-col gap-2">
        <Heading level={3} size="title">
          {t("addressHeading")}
        </Heading>
        <div className="flex items-center gap-1">
          <Text as="span" className="min-w-0 break-all font-medium" data-testid="settings-address">
            {address}
          </Text>
          <CopyButton text={address} label={t("copyAddress")} />
        </div>
        {quota ? (
          <div className="max-w-sm">
            <Progress value={usedPct} aria-label={t("storageLabel")} />
            <Text size="caption" tone="muted" className="mt-1.5 tabular-nums">
              {t("storage", {
                used: fileSize(quota.usedBytes, locale),
                limit: fileSize(quota.limitBytes, locale),
              })}
            </Text>
          </div>
        ) : null}
        <Button asChild variant="secondary" size="sm" className="self-start">
          <Link href="/mail">{t("openInbox")}</Link>
        </Button>
      </div>

      <div className="flex flex-col gap-2">
        <Heading level={3} size="title">
          {t("appsHeading")}
        </Heading>
        <Text size="body-sm" tone="muted" className="max-w-[62ch]">
          {t("appsIntro")}
        </Text>
        <AppPasswords />
      </div>

      <DeleteMailbox />
    </Section>
  );
}
