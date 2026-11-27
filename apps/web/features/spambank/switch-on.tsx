"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Ban, FileText, Inbox } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@yourtal/ui/button";
import { Heading } from "@yourtal/ui/heading";
import { Notice } from "@yourtal/ui/notice";
import { Text } from "@yourtal/ui/text";
import { CopyButton } from "./copy-button";
import { enableMailboxAction } from "./spambank-actions";

export type SwitchOnPhase =
  | { step: "idle" }
  | { step: "working" }
  | { step: "done"; address: string }
  | { step: "error"; message: string };

const POINTS: readonly { key: "address" | "filing" | "statements"; icon: LucideIcon }[] = [
  { key: "address", icon: Inbox },
  { key: "filing", icon: Ban },
  { key: "statements", icon: FileText },
];

/** The words and buttons, with no state of its own. */
export function SwitchOnView({
  phase,
  onSwitchOn,
  onContinue,
}: {
  phase: SwitchOnPhase;
  onSwitchOn: () => void;
  onContinue: () => void;
}) {
  const t = useTranslations("spambank.switchOn");
  const tc = useTranslations("spambank.common");
  if (phase.step === "done") {
    return (
      <div className="flex max-w-[620px] flex-col gap-5">
        <div>
          <Heading level={1} size="headline">
            {t("doneTitle")}
          </Heading>
          <Text tone="muted" className="mt-1">
            {t("doneBody")}
          </Text>
        </div>
        <div className="rounded-card border border-border-subtle bg-accent-subtle p-4">
          <Text size="caption" tone="muted" className="font-bold uppercase tracking-wide">
            {t("yourAddress")}
          </Text>
          <div className="mt-2 flex items-center gap-1">
            <Text as="span" className="min-w-0 break-all font-semibold" data-testid="new-address">
              {phase.address}
            </Text>
            <CopyButton text={phase.address} label={tc("copyAddress")} />
          </div>
          <Text size="body-sm" tone="muted" className="mt-3">
            {t("doneHint")}
          </Text>
        </div>
        <Button onClick={onContinue} className="self-start">
          {t("openInbox")}
        </Button>
      </div>
    );
  }
  const working = phase.step === "working";
  return (
    <div className="flex max-w-[620px] flex-col gap-5">
      <div>
        <Heading level={1} size="headline">
          {t("title")}
        </Heading>
        <Text tone="muted" className="mt-1">
          {t("lede")}
        </Text>
      </div>
      <ul className="flex flex-col gap-4">
        {POINTS.map(({ key, icon: Icon }) => (
          <li key={key} className="flex gap-3 text-body font-sans text-fg">
            <Icon aria-hidden="true" className="mt-0.5 size-5 shrink-0 text-accent" />
            <span>{t(`points.${key}`)}</span>
          </li>
        ))}
      </ul>
      {phase.step === "error" ? <Notice tone="danger">{phase.message}</Notice> : null}
      <div className="flex flex-wrap items-center gap-4">
        <Button size="lg" onClick={onSwitchOn} disabled={working}>
          {working ? t("working") : t("cta")}
        </Button>
        <Text as="span" size="caption" tone="muted">
          {t("adultsOnly")}
        </Text>
      </div>
    </div>
  );
}

export function SwitchOn() {
  const t = useTranslations("spambank.switchOn");
  const router = useRouter();
  const [phase, setPhase] = useState<SwitchOnPhase>({ step: "idle" });

  async function switchOn() {
    setPhase({ step: "working" });
    const result = await enableMailboxAction().catch(() => null);
    if (result?.ok) return setPhase({ step: "done", address: result.data.address });
    const code = result?.error.kind === "http" ? result.error.code : null;
    setPhase({
      step: "error",
      message: code === "not_allowed" ? t("notAllowed") : t("failed"),
    });
  }

  // The layout was rendered before the mailbox existed; refreshing re-reads it.
  return (
    <SwitchOnView
      phase={phase}
      onSwitchOn={() => void switchOn()}
      onContinue={() => router.refresh()}
    />
  );
}
