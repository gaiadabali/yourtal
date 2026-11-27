import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { getTranslations } from "next-intl/server";
import { EmptyState } from "@yourtal/ui/empty-state";
import { ErrorState } from "@yourtal/ui/error-state";
import { PageContainer } from "@yourtal/ui/page-container";
import { ClientMessages } from "@/features/shell/client-messages";
import { LazyMailFrame } from "@/features/spambank/mail-lazy";
import { SwitchOn } from "@/features/spambank/switch-on";
import { getMailboxStatus } from "@/features/spambank/spambank-data";

/**
 * The gate for every mail screen, in the order a person meets it:
 *
 *  1. Not offered (the feature is off, or a teen's account): 404. Mail is for adults and private;
 *     there is nothing to explain.
 *  2. A failed read: an explanation, never a blank page.
 *  3. Suspended: a plain message. No mailbox yet: the switch-on screen.
 *  4. A mailbox: the mail screens, inside the shell. The screens and the engine load after the page
 *     (`mail-lazy.tsx`); the nav badge does too, and shares the tab's one client with them.
 *
 * This is a convenience for the person, never the security boundary: Cerbos decides who may have
 * a mailbox, and the mail proxy only serves a token the server minted for this person.
 */
export default async function MailLayout({ children }: { children: ReactNode }) {
  const t = await getTranslations("spambank");
  const status = await getMailboxStatus();

  let body: ReactNode;
  if (!status.ok) {
    // A 401 never gets here: proxy.ts sends a visitor without a session to sign in first.
    body = <ErrorState title={t("gate.errorTitle")} description={t("gate.errorBody")} />;
  } else if (!status.data.available || status.data.state === "not_allowed") {
    notFound();
  } else if (status.data.state === "suspended") {
    body = <EmptyState title={t("gate.suspendedTitle")} description={t("gate.suspendedBody")} />;
  } else if (status.data.state !== "on" || !status.data.address) {
    body = <SwitchOn />;
  } else {
    body = <LazyMailFrame address={status.data.address}>{children}</LazyMailFrame>;
  }

  return (
    <ClientMessages namespaces={["spambank"]}>
      <PageContainer width="wide" className="py-6">
        {body}
      </PageContainer>
    </ClientMessages>
  );
}
