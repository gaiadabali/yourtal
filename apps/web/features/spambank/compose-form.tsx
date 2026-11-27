"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import type { SyntheticEvent } from "react";
import { Paperclip, Send, X } from "lucide-react";
import { useTranslations } from "next-intl";
import type { Attachment, Draft } from "@yourtal/mail-engine";
import { useMailClient } from "@yourtal/mail-engine/react";
import { Button } from "@yourtal/ui/button";
import { Heading } from "@yourtal/ui/heading";
import { Input } from "@yourtal/ui/input";
import { Textarea } from "@yourtal/ui/textarea";
import { fileSize } from "./mail-format";
import { folderHref } from "./mail-routes";
import type { ComposeMode } from "./mail-routes";
import { useMailBase } from "./mail-root";
import { MailNotice, flashNotice, useMailErrorText, useMailLocale } from "./mail-ui";
import { formatAddresses, parseAddresses } from "./mail-text";

/** The proxy accepts uploads up to 25 MB (BUILD.md section 4.3). */
export const MAX_UPLOAD_BYTES = 25 * 1000 * 1000;
const MAX_RECIPIENTS = 10;

/** The compose form for a new message, a reply, a forward or a draft being edited. */
export function ComposeForm({ mode, initial }: { mode: ComposeMode; initial: Draft }) {
  const t = useTranslations("spambank.compose");
  const client = useMailClient();
  const base = useMailBase();
  const router = useRouter();
  const locale = useMailLocale();
  const errorText = useMailErrorText();
  const body = useRef<HTMLTextAreaElement>(null);
  const picker = useRef<HTMLInputElement>(null);

  const [to, setTo] = useState(formatAddresses(initial.to));
  const [cc, setCc] = useState(formatAddresses(initial.cc));
  const [bcc, setBcc] = useState(formatAddresses(initial.bcc));
  const [showCc, setShowCc] = useState(
    (initial.cc?.length ?? 0) > 0 || (initial.bcc?.length ?? 0) > 0,
  );
  const [subject, setSubject] = useState(initial.subject);
  const [text, setText] = useState(initial.text);
  const [files, setFiles] = useState<Attachment[]>(initial.attachments ?? []);
  const [uploading, setUploading] = useState<string[]>([]);
  const [draftId, setDraftId] = useState<string | undefined>(initial.draftId);
  const [phase, setPhase] = useState<"idle" | "saving" | "sending">("idle");
  const [dirty, setDirty] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [askSubject, setAskSubject] = useState(false);
  const [askDiscard, setAskDiscard] = useState(false);

  const touch = () => {
    setDirty(true);
    setSaved(false);
    setProblem(null);
    setAskSubject(false);
  };

  // A reply starts typing above the quote; a forward and a new message start at To.
  useEffect(() => {
    if (mode === "reply" || mode === "replyAll") {
      body.current?.focus();
      body.current?.setSelectionRange(0, 0);
    }
  }, [mode]);

  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => {
      e.preventDefault();
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  /** The draft as typed, or the reason it cannot be sent. */
  function build(forSend: boolean): { draft: Draft } | { error: string } {
    const toList = parseAddresses(to);
    const ccList = parseAddresses(cc);
    const bccList = parseAddresses(bcc);
    const bad = [...toList.invalid, ...ccList.invalid, ...bccList.invalid];
    if (bad.length > 0) {
      return {
        error: t("badAddresses", { count: bad.length, list: bad.slice(0, 3).join(", ") }),
      };
    }
    if (forSend) {
      const all = new Set(
        [...toList.ok, ...ccList.ok, ...bccList.ok].map((a) => a.email.toLowerCase()),
      );
      if (all.size === 0) return { error: t("needRecipient") };
      if (all.size > MAX_RECIPIENTS) return { error: t("tooMany", { max: MAX_RECIPIENTS }) };
    }
    const draft: Draft = { to: toList.ok, subject: subject.trim(), text };
    if (ccList.ok.length > 0) draft.cc = ccList.ok;
    if (bccList.ok.length > 0) draft.bcc = bccList.ok;
    if (files.length > 0) draft.attachments = files;
    if (draftId) draft.draftId = draftId;
    if (initial.inReplyTo) draft.inReplyTo = initial.inReplyTo;
    if (initial.references) draft.references = initial.references;
    return { draft };
  }

  async function saveDraft() {
    const built = build(false);
    if ("error" in built) return setProblem(built.error);
    setPhase("saving");
    setProblem(null);
    try {
      const { draftId: id } = await client.saveDraft(built.draft);
      setDraftId(id);
      setDirty(false);
      setSaved(true);
    } catch (e) {
      setProblem(errorText(e));
    } finally {
      setPhase("idle");
    }
  }

  async function send(e: SyntheticEvent) {
    e.preventDefault();
    if (phase !== "idle" || uploading.length > 0) return;
    const built = build(true);
    if ("error" in built) return setProblem(built.error);
    if (built.draft.subject === "" && !askSubject) {
      setAskSubject(true);
      return;
    }
    setPhase("sending");
    setProblem(null);
    try {
      await client.send(built.draft);
      setDirty(false);
      flashNotice(t("sent"));
      router.push(folderHref(base, "sent"));
    } catch (err) {
      setProblem(errorText(err));
      setPhase("idle");
    }
  }

  async function attach(list: FileList | null) {
    if (!list) return;
    setProblem(null);
    for (const file of Array.from(list)) {
      if (file.size > MAX_UPLOAD_BYTES) {
        setProblem(
          t("fileTooBig", {
            name: file.name,
            size: fileSize(file.size, locale),
            max: fileSize(MAX_UPLOAD_BYTES, locale),
          }),
        );
        continue;
      }
      setUploading((u) => [...u, file.name]);
      try {
        const att = await client.upload({ kind: "blob", blob: file, name: file.name });
        setFiles((f) => [...f, att]);
        setDirty(true);
        setSaved(false);
      } catch (e) {
        setProblem(`${file.name}: ${errorText(e)}`);
      } finally {
        setUploading((u) => {
          const at = u.indexOf(file.name);
          return at < 0 ? u : [...u.slice(0, at), ...u.slice(at + 1)];
        });
      }
    }
    if (picker.current) picker.current.value = "";
  }

  async function discard() {
    if (dirty && !askDiscard) {
      setAskDiscard(true);
      return;
    }
    setDirty(false);
    if (draftId && mode === "draft") {
      try {
        await client.remove([draftId]);
      } catch {
        // The draft stays in Drafts; leaving is still what the person asked for.
      }
    }
    router.push(folderHref(base, mode === "draft" ? "drafts" : "inbox"));
  }

  const busy = phase !== "idle";

  return (
    <form onSubmit={(e) => void send(e)} aria-labelledby="compose-title" noValidate>
      <div className="mb-3 flex items-center justify-between gap-3">
        <Heading level={2} id="compose-title">
          {t(`title.${mode}`)}
        </Heading>
        <span role="status" className="text-caption font-sans text-fg-muted">
          {phase === "saving" ? t("saving") : saved ? t("saved") : ""}
        </span>
      </div>

      <div className="flex flex-col gap-3 rounded-card border border-border-subtle bg-surface p-4">
        <div className="flex items-end gap-2">
          <Input
            wrapperClassName="flex-1"
            label={t("to")}
            type="text"
            inputMode="email"
            autoComplete="off"
            autoFocus={mode === "new" || mode === "forward" || mode === "draft"}
            value={to}
            onChange={(e) => {
              setTo(e.target.value);
              touch();
            }}
            placeholder={t("toPlaceholder")}
          />
          {!showCc ? (
            <Button
              type="button"
              variant="link"
              size="sm"
              onClick={() => setShowCc(true)}
              className="mb-3"
            >
              {t("ccBcc")}
            </Button>
          ) : null}
        </div>
        {showCc ? (
          <>
            <Input
              label={t("cc")}
              type="text"
              inputMode="email"
              autoComplete="off"
              value={cc}
              onChange={(e) => {
                setCc(e.target.value);
                touch();
              }}
            />
            <Input
              label={t("bcc")}
              type="text"
              inputMode="email"
              autoComplete="off"
              value={bcc}
              onChange={(e) => {
                setBcc(e.target.value);
                touch();
              }}
            />
          </>
        ) : null}
        <Input
          label={t("subject")}
          type="text"
          autoComplete="off"
          maxLength={300}
          value={subject}
          onChange={(e) => {
            setSubject(e.target.value);
            touch();
          }}
        />
        <Textarea
          ref={body}
          label={t("message")}
          rows={14}
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            touch();
          }}
        />

        {files.length > 0 || uploading.length > 0 ? (
          <ul
            aria-label={t("attachments")}
            className="flex flex-wrap gap-2 border-t border-border-subtle pt-3"
          >
            {files.map((f, i) => (
              <li
                key={`${f.blobId}-${i}`}
                className="flex max-w-full items-center gap-2 rounded-control border border-border-control px-2.5 py-1.5 text-caption font-sans"
              >
                <Paperclip aria-hidden="true" className="size-3.5 shrink-0" />
                <span className="min-w-0 truncate font-medium text-fg">{f.name}</span>
                <span className="shrink-0 tabular-nums text-fg-muted">
                  {fileSize(f.size, locale)}
                </span>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  aria-label={t("removeFile", { name: f.name })}
                  onClick={() => {
                    setFiles((cur) => cur.filter((_, at) => at !== i));
                    touch();
                  }}
                  className="size-6"
                >
                  <X aria-hidden="true" className="size-3.5" />
                </Button>
              </li>
            ))}
            {uploading.map((name, i) => (
              <li
                key={`up-${name}-${i}`}
                className="flex items-center gap-2 rounded-control border border-dashed border-border-control px-2.5 py-1.5 text-caption font-sans text-fg-muted"
              >
                <Paperclip aria-hidden="true" className="size-3.5" />
                <span className="truncate">{t("uploading", { name })}</span>
              </li>
            ))}
          </ul>
        ) : null}
      </div>

      {problem ? (
        <div className="mt-3">
          <MailNotice tone="error">{problem}</MailNotice>
        </div>
      ) : null}
      {askSubject ? (
        <div className="mt-3">
          <MailNotice>{t("noSubject")}</MailNotice>
        </div>
      ) : null}

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <Button
          type="submit"
          disabled={busy || uploading.length > 0}
          leadingIcon={<Send aria-hidden="true" className="size-4" />}
        >
          {phase === "sending" ? t("sending") : t("send")}
        </Button>
        <Button type="button" variant="secondary" disabled={busy} onClick={() => void saveDraft()}>
          {t("saveDraft")}
        </Button>
        <input
          ref={picker}
          id="compose-files"
          type="file"
          multiple
          className="sr-only"
          onChange={(e) => void attach(e.target.files)}
          aria-label={t("attachFiles")}
        />
        <Button
          type="button"
          variant="ghost"
          onClick={() => picker.current?.click()}
          leadingIcon={<Paperclip aria-hidden="true" className="size-4" />}
        >
          {t("attachFiles")}
        </Button>
        <span className="ml-auto flex items-center gap-2">
          {askDiscard ? (
            <>
              <span className="text-caption font-sans text-fg">{t("discardAsk")}</span>
              <Button type="button" variant="danger" size="sm" onClick={() => void discard()}>
                {t("discard")}
              </Button>
              <Button type="button" variant="ghost" size="sm" onClick={() => setAskDiscard(false)}>
                {t("keepEditing")}
              </Button>
            </>
          ) : (
            <Button type="button" variant="ghost" onClick={() => void discard()}>
              {t("discard")}
            </Button>
          )}
        </span>
      </div>
    </form>
  );
}
