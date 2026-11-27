"use client";

import { useCallback, useEffect, useState } from "react";
import type { SyntheticEvent } from "react";
import { useTranslations } from "next-intl";
import type {
  AppPasswordCreated,
  AppPasswordSummary,
} from "@yourtal/contracts/spambank/management";
import { Badge } from "@yourtal/ui/badge";
import { Button } from "@yourtal/ui/button";
import { Heading } from "@yourtal/ui/heading";
import { Input } from "@yourtal/ui/input";
import { Text } from "@yourtal/ui/text";
import { CopyButton } from "./copy-button";
import { dayDate } from "./mail-format";
import { APP_PASSWORDS_MAX, APP_PASSWORD_NAME_MAX } from "./mail-limits";
import { ErrorBlock, ListSkeleton, MailNotice, useMailLocale } from "./mail-ui";
import {
  createAppPasswordAction,
  listAppPasswordsAction,
  revokeAppPasswordAction,
} from "./spambank-actions";

function Detail({
  label,
  value,
  copy,
  copyLabel,
}: {
  label: string;
  value: string;
  copy: string;
  copyLabel: string;
}) {
  return (
    <div className="flex items-center gap-3 py-1.5">
      <dt className="w-24 shrink-0 text-caption font-sans text-fg-muted">{label}</dt>
      <dd className="min-w-0 flex-1 break-all text-body-sm font-sans text-fg">{value}</dd>
      <CopyButton text={copy} label={copyLabel} />
    </div>
  );
}

/** What a phone mail app needs, shown once when the password is created. */
export function AppPasswordSecret({
  created,
  onDone,
}: {
  created: AppPasswordCreated;
  onDone: () => void;
}) {
  const t = useTranslations("spambank.appPasswords");
  const security = (s: string) => (s === "ssl" ? "SSL/TLS" : s);
  return (
    <section
      aria-label={t("secretLabel")}
      data-testid="app-password-secret"
      className="rounded-card border border-border-subtle bg-accent-subtle p-4"
    >
      <Heading level={3} size="title">
        {t("secretTitle", { name: created.name })}
      </Heading>
      <Text size="body-sm" className="mt-1">
        {t("secretOnce")}
      </Text>
      <dl className="mt-3 divide-y divide-border-subtle rounded-control bg-surface px-3">
        <Detail
          label={t("password")}
          value={created.secret}
          copy={created.secret}
          copyLabel={t("copyPassword")}
        />
        <Detail
          label={t("username")}
          value={created.username}
          copy={created.username}
          copyLabel={t("copyUsername")}
        />
        <Detail
          label={t("incoming")}
          value={t("server", {
            host: created.imap.host,
            port: created.imap.port,
            security: security(created.imap.security),
          })}
          copy={created.imap.host}
          copyLabel={t("copyIncoming")}
        />
        <Detail
          label={t("outgoing")}
          value={t("server", {
            host: created.smtp.host,
            port: created.smtp.port,
            security: security(created.smtp.security),
          })}
          copy={created.smtp.host}
          copyLabel={t("copyOutgoing")}
        />
      </dl>
      <Text size="caption" tone="muted" className="mt-2">
        {t("secretHint")}
      </Text>
      <Button size="sm" onClick={onDone} className="mt-3">
        {t("copied")}
      </Button>
    </section>
  );
}

/** App passwords for a phone's mail app: create (shown once), list, revoke. At most five. */
export function AppPasswords() {
  const t = useTranslations("spambank.appPasswords");
  const locale = useMailLocale();
  const [items, setItems] = useState<AppPasswordSummary[] | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [name, setName] = useState("");
  const [creating, setCreating] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [created, setCreated] = useState<AppPasswordCreated | null>(null);
  const [revoking, setRevoking] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoadFailed(false);
    const result = await listAppPasswordsAction().catch(() => null);
    if (result?.ok) setItems(result.data.items);
    else setLoadFailed(true);
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  async function create(e: SyntheticEvent) {
    e.preventDefault();
    const trimmed = name.trim();
    if (trimmed === "") return setProblem(t("nameNeeded"));
    setCreating(true);
    setProblem(null);
    const result = await createAppPasswordAction(trimmed).catch(() => null);
    setCreating(false);
    if (!result?.ok) {
      const limit = result?.error.kind === "http" && result.error.status === 409;
      return setProblem(limit ? t("limitReached", { max: APP_PASSWORDS_MAX }) : t("createFailed"));
    }
    const made = result.data;
    setCreated(made);
    setName("");
    setItems((cur) => [
      ...(cur ?? []),
      { id: made.id, name: made.name, createdAt: made.createdAt },
    ]);
  }

  async function revoke(id: string) {
    setRevoking(id);
    setProblem(null);
    const result = await revokeAppPasswordAction(id).catch(() => null);
    setRevoking(null);
    if (!result?.ok) return setProblem(t("revokeFailed"));
    setItems((cur) => (cur ?? []).filter((i) => i.id !== id));
    setConfirm(null);
  }

  const full = (items?.length ?? 0) >= APP_PASSWORDS_MAX;

  return (
    <div className="flex flex-col gap-4">
      {created ? <AppPasswordSecret created={created} onDone={() => setCreated(null)} /> : null}

      {loadFailed ? (
        <ErrorBlock message={t("loadFailed")} onRetry={() => void load()} />
      ) : items === null ? (
        <ListSkeleton rows={2} />
      ) : items.length === 0 ? (
        <Text size="body-sm" tone="muted">
          {t("none")}
        </Text>
      ) : (
        <ul
          className="divide-y divide-border-subtle border-y border-border-subtle"
          data-testid="app-password-list"
        >
          {items.map((i) => (
            <li key={i.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 py-3">
              <span className="min-w-0 flex-1 truncate text-body-sm font-sans font-medium text-fg">
                {i.name}
              </span>
              <span className="text-caption font-sans text-fg-muted">
                {t("createdOn", { date: dayDate(i.createdAt, locale) })}
              </span>
              {confirm === i.id ? (
                <span
                  className="flex flex-wrap items-center gap-2"
                  role="group"
                  aria-label={t("confirmRevoke", { name: i.name })}
                >
                  <Text as="span" size="caption">
                    {t("revokeWarning")}
                  </Text>
                  <Button
                    size="sm"
                    variant="danger"
                    disabled={revoking === i.id}
                    onClick={() => void revoke(i.id)}
                  >
                    {revoking === i.id ? t("revoking") : t("revoke")}
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setConfirm(null)}>
                    {t("cancel")}
                  </Button>
                </span>
              ) : (
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => setConfirm(i.id)}
                  aria-label={t("revokeNamed", { name: i.name })}
                >
                  {t("revoke")}
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}

      {problem ? <MailNotice tone="error">{problem}</MailNotice> : null}

      {full ? (
        <Text size="body-sm" tone="muted">
          <Badge variant="warning">{t("limitBadge")}</Badge>{" "}
          {t("limitReached", { max: APP_PASSWORDS_MAX })}
        </Text>
      ) : (
        <form onSubmit={(e) => void create(e)} className="flex flex-wrap items-end gap-3">
          <Input
            wrapperClassName="min-w-[220px] flex-1"
            label={t("nameLabel")}
            type="text"
            value={name}
            onChange={(e) => {
              setName(e.target.value);
              setProblem(null);
            }}
            maxLength={APP_PASSWORD_NAME_MAX}
            placeholder={t("namePlaceholder")}
            autoComplete="off"
          />
          <Button type="submit" variant="secondary" disabled={creating || name.trim() === ""}>
            {creating ? t("creating") : t("create")}
          </Button>
        </form>
      )}
    </div>
  );
}
