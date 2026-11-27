"use client";

import Link from "next/link";
import type { Route } from "next";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import { ChevronLeft, Forward, Reply, ReplyAll, ShieldCheck, Star, Trash2 } from "lucide-react";
import { useTranslations } from "next-intl";
import type { Attachment, FolderKey } from "@yourtal/mail-engine";
import { useMailClient, useMessage, useSandboxDocument } from "@yourtal/mail-engine/react";
import { Button } from "@yourtal/ui/button";
import { ChannelAvatar } from "@yourtal/ui/channel-avatar";
import { cn } from "@yourtal/ui/cn";
import { Heading } from "@yourtal/ui/heading";
import { NativeSelect } from "@yourtal/ui/native-select";
import { Text } from "@yourtal/ui/text";
import { AttachmentList, saveBlob } from "./attachment-list";
import { fullAddress, fullDate, senderLabel } from "./mail-format";
import { FOLDER_ORDER, composeHref, folderHref } from "./mail-routes";
import { useMailBase } from "./mail-root";
import {
  ErrorBlock,
  ListSkeleton,
  MailNotice,
  flashNotice,
  useIsDark,
  useMailErrorText,
  useMailLocale,
  useNotice,
} from "./mail-ui";
import { PlainBody, SandboxFrame } from "./message-body";
import { UnsubscribeBar } from "./unsubscribe-bar";
import type { UnsubState } from "./unsubscribe-bar";

function HeaderRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex gap-3">
      <dt className="w-12 shrink-0 text-fg-muted">{label}</dt>
      <dd className="min-w-0 break-words text-fg">{children}</dd>
    </div>
  );
}

function BackLink({ href, label }: { href: Route; label: string }) {
  return (
    <Link
      href={href}
      className="mb-3 inline-flex items-center gap-1 text-caption font-sans font-semibold text-accent-text hover:underline"
    >
      <ChevronLeft aria-hidden="true" className="size-4" />
      {label}
    </Link>
  );
}

/** One message: actions, headers, the body (HTML in the sandbox, or plain text), attachments. */
export function Reader({ id }: { id: string }) {
  const t = useTranslations("spambank");
  const client = useMailClient();
  const base = useMailBase();
  const router = useRouter();
  const dark = useIsDark();
  const locale = useMailLocale();
  const errorText = useMailErrorText();
  const { message, loading, error } = useMessage(id);
  const html = useSandboxDocument(id, message?.hasHtml === true, { dark });
  const { notice, fail, clear } = useNotice();
  const [flagged, setFlagged] = useState<boolean | null>(null);
  const [plain, setPlain] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [downloading, setDownloading] = useState<string | null>(null);
  const [unsub, setUnsub] = useState<UnsubState>({ step: "idle" });
  const [moveToJunk, setMoveToJunk] = useState(true);

  // Opening a message reads it, once.
  const unread = message?.unread === true;
  useEffect(() => {
    if (unread) void client.setRead([id], true).catch(() => undefined);
  }, [client, id, unread]);

  if (error && !message) {
    const gone = error.code === "rejected";
    return (
      <div>
        <BackLink href={folderHref(base, "inbox")} label={t("folders.inbox")} />
        <ErrorBlock message={gone ? t("reader.gone") : errorText(error)} />
      </div>
    );
  }
  if (loading || !message) {
    return (
      <div>
        <BackLink href={folderHref(base, "inbox")} label={t("folders.inbox")} />
        <ListSkeleton rows={3} />
      </div>
    );
  }

  const folder: FolderKey = message.folder ?? "inbox";
  const back = folderHref(base, folder);
  const isFlagged = flagged ?? message.flagged;
  const everyone = message.to.length + message.cc.length > 1;
  const unknown = t("list.unknownSender");

  const leave = (text: string) => {
    flashNotice(text);
    router.push(back);
  };

  async function act(task: () => Promise<void>, done: string) {
    clear();
    try {
      await task();
      leave(done);
    } catch (e) {
      fail(errorText(e));
    }
  }

  async function download(att: Attachment) {
    setDownloading(att.blobId);
    clear();
    try {
      const out = await client.download(att);
      if (out instanceof Blob) saveBlob(out, att.name);
    } catch (e) {
      fail(errorText(e));
    } finally {
      setDownloading(null);
    }
  }

  async function unsubscribe() {
    setUnsub({ step: "working" });
    const move = moveToJunk && folder !== "junk" && folder !== "spam";
    try {
      const result = await client.unsubscribe(id, move ? { moveToJunk: true } : undefined);
      if (result.status === "done") setUnsub({ step: "done", result, moved: move });
      else if (result.status === "open_link") setUnsub({ step: "link", url: result.url });
      else setUnsub({ step: "failed", unavailable: result.status === "unavailable" });
    } catch {
      setUnsub({ step: "failed", unavailable: false });
    }
  }

  const showHtml = message.hasHtml && !plain && !html.error;
  const text = message.text ?? message.preview;
  const subject = message.subject.trim() || t("list.noSubject");

  return (
    <article aria-label={subject} className="flex flex-col gap-4">
      <div>
        <BackLink href={back} label={t(`folders.${folder}`)} />
        <Heading level={2} size="headline" className="[overflow-wrap:anywhere]">
          {subject}
        </Heading>
      </div>

      <div
        className="flex flex-wrap items-center gap-2 border-y border-border-subtle py-2"
        role="toolbar"
        aria-label={t("reader.actions")}
      >
        <Button asChild variant="secondary" size="sm">
          <Link href={composeHref(base, "reply", id)}>
            <Reply aria-hidden="true" className="size-4" /> {t("reader.reply")}
          </Link>
        </Button>
        {everyone ? (
          <Button asChild variant="secondary" size="sm">
            <Link href={composeHref(base, "replyAll", id)}>
              <ReplyAll aria-hidden="true" className="size-4" /> {t("reader.replyAll")}
            </Link>
          </Button>
        ) : null}
        <Button asChild variant="secondary" size="sm">
          <Link href={composeHref(base, "forward", id)}>
            <Forward aria-hidden="true" className="size-4" /> {t("reader.forward")}
          </Link>
        </Button>
        <span aria-hidden="true" className="mx-1 hidden h-5 w-px bg-border-subtle sm:block" />
        {folder === "spam" ? (
          <Button
            size="sm"
            variant="secondary"
            onClick={() => void act(() => client.move([id], "inbox"), t("reader.notSpamDone"))}
          >
            {t("reader.notSpam")}
          </Button>
        ) : null}
        <NativeSelect
          label={t("reader.moveTo")}
          hideLabel
          value=""
          onChange={(e) => {
            const to = e.target.value as FolderKey | "";
            if (to) {
              void act(
                () => client.move([id], to),
                t("reader.movedTo", { folder: t(`folders.${to}`) }),
              );
            }
          }}
          className="h-control-compact text-caption"
        >
          <option value="">{t("list.moveTo")}</option>
          {FOLDER_ORDER.filter((f) => f !== folder).map((f) => (
            <option key={f} value={f}>
              {t(`folders.${f}`)}
            </option>
          ))}
        </NativeSelect>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-pressed={isFlagged}
          aria-label={isFlagged ? t("list.unstar") : t("list.star")}
          onClick={() => {
            const next = !isFlagged;
            setFlagged(next);
            void client.setFlagged([id], next).catch((e: unknown) => {
              setFlagged(!next);
              fail(errorText(e));
            });
          }}
          className={cn("size-9", isFlagged ? "text-warning-solid" : "text-fg-muted")}
        >
          <Star
            aria-hidden="true"
            className="size-[17px]"
            fill={isFlagged ? "currentColor" : "none"}
          />
        </Button>
        <Button
          size="sm"
          variant="ghost"
          onClick={() => void act(() => client.setRead([id], false), t("reader.markedUnread"))}
        >
          {t("list.markUnread")}
        </Button>
        <span className="ml-auto" />
        {confirmDelete ? (
          <span
            className="flex items-center gap-2"
            role="group"
            aria-label={t("list.confirmDelete")}
          >
            <Text as="span" size="caption">
              {t("reader.deleteAsk")}
            </Text>
            <Button
              size="sm"
              variant="danger"
              onClick={() => void act(() => client.remove([id]), t("reader.deleted"))}
            >
              {t("list.delete")}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setConfirmDelete(false)}>
              {t("common.cancel")}
            </Button>
          </span>
        ) : (
          <Button
            size="sm"
            variant="secondary"
            onClick={() =>
              folder === "trash"
                ? setConfirmDelete(true)
                : void act(() => client.remove([id]), t("reader.trashed"))
            }
            leadingIcon={<Trash2 aria-hidden="true" className="size-4" />}
          >
            {folder === "trash" ? t("list.deleteForever") : t("list.delete")}
          </Button>
        )}
      </div>

      {notice ? (
        <MailNotice tone={notice.tone} onDismiss={clear}>
          {notice.text}
        </MailNotice>
      ) : null}

      <header className="flex gap-3">
        <ChannelAvatar name={senderLabel(message.from, unknown)} size="md" decorative />
        <dl className="min-w-0 flex-1 space-y-0.5 text-caption font-sans">
          <HeaderRow label={t("reader.from")}>
            {message.from ? fullAddress(message.from) : unknown}
          </HeaderRow>
          {message.replyTo.length > 0 && message.replyTo[0]?.email !== message.from?.email ? (
            <HeaderRow label={t("reader.replyTo")}>
              {message.replyTo.map(fullAddress).join(", ")}
            </HeaderRow>
          ) : null}
          <HeaderRow label={t("reader.to")}>
            {message.to.length > 0
              ? message.to.map(fullAddress).join(", ")
              : t("list.noRecipients")}
          </HeaderRow>
          {message.cc.length > 0 ? (
            <HeaderRow label={t("reader.cc")}>{message.cc.map(fullAddress).join(", ")}</HeaderRow>
          ) : null}
          <HeaderRow label={t("reader.date")}>
            <time dateTime={message.receivedAt}>{fullDate(message.receivedAt, locale)}</time>
          </HeaderRow>
        </dl>
      </header>

      <div className="flex flex-col gap-3">
        {message.unsubscribe ? (
          <UnsubscribeBar
            message={message}
            state={unsub}
            moveToJunk={moveToJunk}
            onToggleMove={setMoveToJunk}
            onUnsubscribe={() => void unsubscribe()}
          />
        ) : null}

        {message.hasHtml && html.error ? <MailNotice>{t("reader.htmlFailed")}</MailNotice> : null}

        {showHtml ? (
          html.loading || !html.doc ? (
            <ListSkeleton rows={4} />
          ) : (
            <div className="rounded-card border border-border-subtle bg-surface p-1">
              <SandboxFrame
                doc={html.doc}
                title={t("reader.frameTitle", { who: senderLabel(message.from, unknown) })}
              />
            </div>
          )
        ) : (
          <PlainBody text={text} />
        )}

        {showHtml && html.doc ? (
          <p className="flex flex-wrap items-center gap-x-3 text-caption font-sans text-fg-muted">
            {html.remoteImagesBlocked > 0 ? (
              <span className="inline-flex items-center gap-1.5">
                <ShieldCheck aria-hidden="true" className="size-4" />
                {t("reader.imagesBlocked", { count: html.remoteImagesBlocked })}
              </span>
            ) : null}
            {message.text ? (
              <Button type="button" variant="link" size="sm" onClick={() => setPlain(true)}>
                {t("reader.viewPlain")}
              </Button>
            ) : null}
          </p>
        ) : null}
        {message.hasHtml && plain ? (
          <p>
            <Button type="button" variant="link" size="sm" onClick={() => setPlain(false)}>
              {t("reader.viewFormatted")}
            </Button>
          </p>
        ) : null}
      </div>

      <AttachmentList
        items={message.attachments}
        locale={locale}
        onDownload={(a) => void download(a)}
        busy={downloading}
      />
    </article>
  );
}
