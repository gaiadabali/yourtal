"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { RefreshCw, Trash2 } from "lucide-react";
import { useTranslations } from "next-intl";
import type { FolderKey, MessageSummary } from "@yourtal/mail-engine";
import { useMailClient, useMessageList } from "@yourtal/mail-engine/react";
import { Button } from "@yourtal/ui/button";
import { cn } from "@yourtal/ui/cn";
import { EmptyState } from "@yourtal/ui/empty-state";
import { NativeSelect } from "@yourtal/ui/native-select";
import { Text } from "@yourtal/ui/text";
import { FOLDER_ORDER, composeHref, messageHref } from "./mail-routes";
import { useMailBase } from "./mail-root";
import {
  ErrorBlock,
  ListSkeleton,
  MailNotice,
  useMailErrorText,
  useMailLocale,
  useNotice,
} from "./mail-ui";
import { MessageRow } from "./message-row";
import { SpamBanner } from "./spam-banner";

/** A folder, or search results. One component so both share selection, bulk actions and paging. */
export function MessageList({ folder, search }: { folder?: FolderKey; search?: string }) {
  const t = useTranslations("spambank");
  const client = useMailClient();
  const base = useMailBase();
  const locale = useMailLocale();
  const errorText = useMailErrorText();
  const source = useMemo(() => (folder ? folder : { search: search ?? "" }), [folder, search]);
  const list = useMessageList(source);
  const { notice, say, fail, clear } = useNotice();
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [busy, setBusy] = useState(false);
  const selectAll = useRef<HTMLInputElement>(null);

  const inTrash = folder === "trash";
  const ids = useMemo(() => new Set(list.items.map((m) => m.id)), [list.items]);
  // Forget anything that is no longer in the list (moved, deleted, refreshed away).
  const chosen = useMemo(() => [...selected].filter((id) => ids.has(id)), [selected, ids]);
  const allChosen = list.items.length > 0 && chosen.length === list.items.length;

  useEffect(() => {
    if (selectAll.current) selectAll.current.indeterminate = chosen.length > 0 && !allChosen;
  }, [chosen.length, allChosen]);
  useEffect(() => {
    // A new folder or query starts with nothing selected.
    setSelected(new Set());
    setConfirmDelete(false);
  }, [folder, search]);

  const toggle = (id: string, on: boolean) =>
    setSelected((cur) => {
      const next = new Set(cur);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });

  async function run(task: () => Promise<void>, done: string) {
    setBusy(true);
    clear();
    try {
      await task();
      say(done);
      setSelected(new Set());
      setConfirmDelete(false);
    } catch (e) {
      fail(errorText(e));
    } finally {
      list.refresh();
      setBusy(false);
    }
  }

  const count = chosen.length;
  const moveTargets = FOLDER_ORDER.filter((f) => f !== folder);
  const title = folder ? t(`folders.${folder}`) : t("list.searchTitle");
  const hint = folder
    ? folder === "spam" || folder === "junk"
      ? t(`folderHint.${folder}`)
      : undefined
    : search
      ? t("list.searchHint", { query: search })
      : undefined;

  return (
    <section aria-labelledby="mail-list-title" className="flex flex-col gap-3">
      <div>
        <h2 id="mail-list-title" className="text-title font-sans font-semibold text-fg">
          {title}
          {list.total > 0 ? (
            <span className="ml-2 text-body-sm font-normal tabular-nums text-fg-muted">
              {list.total}
            </span>
          ) : null}
        </h2>
        {hint ? (
          <Text size="body-sm" tone="muted" className="mt-0.5 max-w-[68ch]">
            {hint}
          </Text>
        ) : null}
      </div>

      {folder === "spam" ? <SpamBanner /> : null}

      <div className="flex min-h-11 flex-wrap items-center gap-2 border-y border-border-subtle py-1">
        <label className="flex items-center gap-2 pl-1.5 text-caption font-sans text-fg-muted sm:pl-3">
          <input
            ref={selectAll}
            type="checkbox"
            checked={allChosen}
            disabled={list.items.length === 0}
            onChange={(e) =>
              setSelected(e.target.checked ? new Set(list.items.map((m) => m.id)) : new Set())
            }
            aria-label={t("list.selectAll")}
            className="size-4 accent-accent"
          />
          <span className={cn(count === 0 && "sr-only")}>{t("list.selected", { count })}</span>
        </label>
        {count > 0 ? (
          confirmDelete ? (
            <div
              className="flex flex-wrap items-center gap-2"
              role="group"
              aria-label={t("list.confirmDelete")}
            >
              <Text as="span" size="body-sm">
                {t("list.deleteForeverAsk", { count })}
              </Text>
              <Button
                size="sm"
                variant="danger"
                disabled={busy}
                onClick={() => void run(() => client.remove(chosen), t("list.deleted", { count }))}
              >
                {t("list.deleteForever")}
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setConfirmDelete(false)}>
                {t("common.cancel")}
              </Button>
            </div>
          ) : (
            <div
              className="flex flex-wrap items-center gap-2"
              role="group"
              aria-label={t("list.actionsLabel")}
            >
              <Button
                size="sm"
                variant="secondary"
                disabled={busy}
                onClick={() =>
                  void run(() => client.setRead(chosen, true), t("list.markedRead", { count }))
                }
              >
                {t("list.markRead")}
              </Button>
              <Button
                size="sm"
                variant="secondary"
                disabled={busy}
                onClick={() =>
                  void run(() => client.setRead(chosen, false), t("list.markedUnread", { count }))
                }
              >
                {t("list.markUnread")}
              </Button>
              <NativeSelect
                label={t("list.moveSelected")}
                hideLabel
                value=""
                disabled={busy}
                onChange={(e) => {
                  const to = e.target.value as FolderKey | "";
                  if (to) {
                    void run(
                      () => client.move(chosen, to),
                      t("list.moved", { count, folder: t(`folders.${to}`) }),
                    );
                  }
                }}
                className="h-control-compact text-caption"
              >
                <option value="">{t("list.moveTo")}</option>
                {moveTargets.map((f) => (
                  <option key={f} value={f}>
                    {t(`folders.${f}`)}
                  </option>
                ))}
              </NativeSelect>
              <Button
                size="sm"
                variant="secondary"
                disabled={busy}
                onClick={() =>
                  inTrash
                    ? setConfirmDelete(true)
                    : void run(() => client.remove(chosen), t("list.trashed", { count }))
                }
                leadingIcon={<Trash2 aria-hidden="true" className="size-4" />}
              >
                {inTrash ? t("list.deleteForever") : t("list.delete")}
              </Button>
            </div>
          )
        ) : (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => list.refresh()}
            className="ml-auto text-fg-muted"
            leadingIcon={<RefreshCw aria-hidden="true" className="size-4" />}
          >
            {t("list.refresh")}
          </Button>
        )}
      </div>

      {notice ? (
        <MailNotice tone={notice.tone} onDismiss={clear}>
          {notice.text}
        </MailNotice>
      ) : null}

      {list.error && list.items.length === 0 ? (
        <ErrorBlock message={errorText(list.error)} onRetry={() => list.refresh()} />
      ) : list.loading && list.items.length === 0 ? (
        <ListSkeleton />
      ) : list.items.length === 0 ? (
        <EmptyState
          title={
            folder
              ? t(`folderEmpty.${folder}`)
              : search
                ? t("list.searchEmpty", { query: search })
                : t("list.searchPrompt")
          }
          {...(!folder && search ? { description: t("list.searchEmptyHint") } : {})}
          action={
            folder === "sent" || folder === "drafts" ? (
              <Button asChild variant="secondary" size="sm">
                <Link href={composeHref(base)}>{t("list.writeMessage")}</Link>
              </Button>
            ) : undefined
          }
        />
      ) : (
        <>
          {list.error ? <MailNotice tone="error">{errorText(list.error)}</MailNotice> : null}
          <ul
            className="divide-y divide-border-subtle border-b border-border-subtle"
            aria-busy={list.loading}
          >
            {list.items.map((m: MessageSummary) => (
              <MessageRow
                key={m.id}
                message={m}
                locale={locale}
                href={
                  m.folder === "drafts" ? composeHref(base, "draft", m.id) : messageHref(base, m.id)
                }
                selected={selected.has(m.id)}
                onSelect={(on) => toggle(m.id, on)}
                onFlag={(on) =>
                  void client.setFlagged([m.id], on).then(
                    () => list.refresh(),
                    (e: unknown) => fail(errorText(e)),
                  )
                }
                showFolder={!folder}
              />
            ))}
          </ul>
          {list.items.length < list.total ? (
            <div className="flex items-center justify-center gap-3 text-caption font-sans text-fg-muted">
              <span className="tabular-nums">
                {t("list.showing", { shown: list.items.length, total: list.total })}
              </span>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => list.loadMore()}
                disabled={list.loading}
              >
                {t("list.showMore")}
              </Button>
            </div>
          ) : null}
        </>
      )}
    </section>
  );
}
