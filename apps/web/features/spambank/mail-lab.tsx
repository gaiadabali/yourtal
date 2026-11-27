"use client";

import { useState } from "react";
import type { ReactNode } from "react";
import { createMemoryMailClient } from "@yourtal/mail-engine/testing";
import { Button } from "@yourtal/ui/button";
import { PageContainer } from "@yourtal/ui/page-container";
import { ViewerShell } from "@/features/shell/viewer-shell";
import type { SupportedLocale } from "@/features/shell/nav-i18n";
import { MAIL_BASE } from "./mail-routes";
import type { MailRoute } from "./mail-routes";
import { MailRoot } from "./mail-root";
import { MailRoutesView } from "./mail-routes-view";
import { MailShell } from "./mail-shell";

const LAB_BASE = `/lab${MAIL_BASE}`;
const ADDRESS = "geewizduck@yourtal.gaiada.com";

/**
 * The frame of the lab preview: the in-memory client and the real viewer shell. Lab only. It lives
 * in the route's layout so the client (like the real shell's) survives moving between screens.
 * "Deliver a message" stands in for new mail arriving, so the nav badge can be watched rising.
 */
export function MailLabFrame({
  locale,
  children,
}: {
  locale: SupportedLocale;
  children: ReactNode;
}) {
  // One client for the page. StrictMode runs an initializer twice and keeps the first result, so
  // the button below must use the state's client, not whichever call ran last.
  const [memory] = useState(() => createMemoryMailClient());
  return (
    <MailRoot createClient={() => memory} base={LAB_BASE}>
      <ViewerShell locale={locale} availablePoints={1240} mail={{ on: true }}>
        <PageContainer width="wide" className="py-6">
          {children}
          <div className="mt-6">
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={() => memory.deliver({ subject: "A brand new message" })}
              data-testid="lab-deliver"
            >
              Deliver a message
            </Button>
          </div>
        </PageContainer>
      </ViewerShell>
    </MailRoot>
  );
}

/** One mail screen, as `/mail` renders it. */
export function MailLabScreen({ route }: { route: MailRoute }) {
  return (
    <MailShell address={ADDRESS}>
      <MailRoutesView route={route} />
    </MailShell>
  );
}
