"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useFormatter, useTranslations } from "next-intl";
import type { PasskeySummary } from "@yourtal/contracts/identity/sign-in-methods";
import { Section } from "@yourtal/ui/section";
import { Input } from "@yourtal/ui/input";
import { Button } from "@yourtal/ui/button";
import { Badge } from "@yourtal/ui/badge";
import { Notice } from "@yourtal/ui/notice";
import { Text } from "@yourtal/ui/text";
import {
  passkeyApiCode,
  runRegistration,
  useBrowserSupportsWebAuthn,
} from "@/features/auth/passkey-ceremony";
import { SignInMethodError } from "./sign-in-method-error";
import {
  registerPasskeyAction,
  registerPasskeyOptionsAction,
  removePasskeyAction,
} from "./sign-in-methods-actions";

export interface MePasskeysSectionProps {
  initialPasskeys: readonly PasskeySummary[];
}

/**
 * Me → Passkeys. Lists them, adds one through the browser's passkey prompt,
 * and removes one after an inline confirm. The list comes from the server, so
 * every change ends in `router.refresh()`; a removed row is hidden at once
 * (`removedIds`) rather than waiting for that round trip. Whether the last
 * sign-in method may go is the API's call (`last_sign_in_method`).
 */
export function MePasskeysSection({ initialPasskeys }: MePasskeysSectionProps) {
  const t = useTranslations("me.passkeys");
  const format = useFormatter();
  const router = useRouter();
  const supported = useBrowserSupportsWebAuthn();
  const [name, setName] = useState("");
  const [removedIds, setRemovedIds] = useState<ReadonlySet<string>>(new Set());
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const [errorCode, setErrorCode] = useState<string | null>(null);
  const [done, setDone] = useState<"added" | "removed" | null>(null);
  const [isPending, startTransition] = useTransition();

  const passkeys = initialPasskeys.filter((passkey) => !removedIds.has(passkey.id));
  const day = (iso: string) => format.dateTime(new Date(iso), { dateStyle: "medium" });

  function handleAdd() {
    setErrorCode(null);
    setDone(null);
    startTransition(async () => {
      const ceremony = await runRegistration(registerPasskeyOptionsAction);
      if (!ceremony.ok) {
        setErrorCode(ceremony.code);
        return;
      }
      const saved = await registerPasskeyAction(ceremony.data.response, name);
      if (!saved.ok) {
        const code = saved.error.kind === "http" ? saved.error.code : saved.error.kind;
        setErrorCode(passkeyApiCode(code));
        return;
      }
      setName("");
      setDone("added");
      router.refresh();
    });
  }

  function handleRemove(id: string) {
    setErrorCode(null);
    setDone(null);
    startTransition(async () => {
      const result = await removePasskeyAction(id);
      setConfirmingId(null);
      if (!result.ok) {
        setErrorCode(result.error.kind === "http" ? result.error.code : result.error.kind);
        return;
      }
      setRemovedIds((ids) => new Set(ids).add(id));
      setDone("removed");
      router.refresh();
    });
  }

  return (
    <Section title={t("heading")} description={t("intro")}>
      <div className="flex flex-col gap-4">
        {passkeys.length === 0 ? (
          <Text size="body-sm" tone="muted">
            {t("empty")}
          </Text>
        ) : (
          <ul className="flex flex-col divide-y divide-border-subtle">
            {passkeys.map((passkey) => (
              <li key={passkey.id} className="flex flex-wrap items-center gap-x-3 gap-y-2 py-3">
                <div className="flex min-w-0 flex-1 flex-col">
                  <span className="flex items-center gap-2 text-body font-sans text-fg">
                    <span className="truncate">{passkey.name}</span>
                    {passkey.synced ? <Badge variant="secondary">{t("syncedBadge")}</Badge> : null}
                  </span>
                  <span className="text-body-sm font-sans text-fg-muted">
                    {t("addedOn", { date: day(passkey.createdAt) })}
                  </span>
                  <span className="text-body-sm font-sans text-fg-muted">
                    {passkey.lastUsedAt
                      ? t("lastUsed", { date: day(passkey.lastUsedAt) })
                      : t("neverUsed")}
                  </span>
                </div>
                {confirmingId === passkey.id ? (
                  <div className="flex flex-col gap-2">
                    <Text size="body-sm">{t("confirmRemove")}</Text>
                    <div className="flex gap-2">
                      <Button
                        type="button"
                        variant="danger"
                        size="sm"
                        disabled={isPending}
                        onClick={() => handleRemove(passkey.id)}
                      >
                        {t("confirmRemoveCta")}
                      </Button>
                      <Button
                        type="button"
                        variant="secondary"
                        size="sm"
                        disabled={isPending}
                        onClick={() => setConfirmingId(null)}
                      >
                        {t("cancelCta")}
                      </Button>
                    </div>
                  </div>
                ) : (
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    disabled={isPending}
                    aria-label={t("removeAria", { name: passkey.name })}
                    onClick={() => {
                      setErrorCode(null);
                      setDone(null);
                      setConfirmingId(passkey.id);
                    }}
                  >
                    {t("removeCta")}
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}

        {supported ? (
          <div className="flex flex-col gap-3">
            <Input
              label={t("nameLabel")}
              helpText={t("nameHelp")}
              maxLength={64}
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
            <Button type="button" onClick={handleAdd} disabled={isPending} className="self-start">
              {t("addCta")}
            </Button>
          </div>
        ) : (
          <Notice tone="info">{t("unsupported")}</Notice>
        )}

        {errorCode ? <SignInMethodError code={errorCode} /> : null}
        {done ? <Notice tone="success">{t(done === "added" ? "added" : "removed")}</Notice> : null}
      </div>
    </Section>
  );
}
