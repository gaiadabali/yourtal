"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import type { SyntheticEvent, ReactNode } from "react";
import { SquarePen } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@yourtal/ui/button";
import { Heading } from "@yourtal/ui/heading";
import { Input } from "@yourtal/ui/input";
import { Text } from "@yourtal/ui/text";
import { CopyButton } from "./copy-button";
import { FolderRail } from "./folder-rail";
import { composeHref, searchHref } from "./mail-routes";
import { useMailBase } from "./mail-root";

export function SearchForm({ initial = "" }: { initial?: string }) {
  const t = useTranslations("spambank.shell");
  const router = useRouter();
  const base = useMailBase();
  const [q, setQ] = useState(initial);
  const submit = (e: SyntheticEvent) => {
    e.preventDefault();
    const text = q.trim();
    if (text) router.push(searchHref(base, text));
  };
  return (
    <form role="search" onSubmit={submit} className="w-full sm:w-72">
      <Input
        label={t("searchLabel")}
        hideLabel
        type="search"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder={t("searchPlaceholder")}
        maxLength={200}
        autoComplete="off"
      />
    </form>
  );
}

/** The frame of every mail screen: title and address, search, Compose, the folder rail. */
export function MailShell({ address, children }: { address: string; children: ReactNode }) {
  const t = useTranslations("spambank.shell");
  const base = useMailBase();
  return (
    <div className="flex flex-col gap-5">
      <header className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
        <div className="min-w-0">
          <Heading level={1} size="headline">
            {t("title")}
          </Heading>
          <div className="mt-1 flex min-w-0 items-center gap-1">
            <Text
              as="span"
              size="body-sm"
              tone="muted"
              className="truncate"
              data-testid="mail-address"
            >
              {address}
            </Text>
            <CopyButton text={address} label={t("copyAddress")} />
          </div>
        </div>
        <div className="flex w-full flex-wrap items-center gap-3 sm:w-auto">
          <SearchForm />
          <Button asChild className="w-full sm:w-auto">
            <Link href={composeHref(base)}>
              <SquarePen aria-hidden="true" className="size-4" />
              {t("compose")}
            </Link>
          </Button>
        </div>
      </header>
      <div className="grid grid-cols-[minmax(0,1fr)] items-start gap-5 md:grid-cols-[12rem_minmax(0,1fr)] md:gap-7">
        <FolderRail />
        <div className="min-w-0">{children}</div>
      </div>
    </div>
  );
}
