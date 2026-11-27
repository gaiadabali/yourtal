import type { ReactNode } from "react";
import { getLocale } from "next-intl/server";
import { ClientMessages } from "@/features/shell/client-messages";
import { MailLabFrame } from "@/features/spambank/mail-lab";

/** `/lab/mail`: the in-memory client and the viewer shell, kept across the screens below. */
export default async function LabMailLayout({ children }: { children: ReactNode }) {
  const locale = await getLocale();
  return (
    <ClientMessages namespaces={["spambank"]}>
      <MailLabFrame locale={locale === "id-ID" ? "id-ID" : "en-AU"}>{children}</MailLabFrame>
    </ClientMessages>
  );
}
