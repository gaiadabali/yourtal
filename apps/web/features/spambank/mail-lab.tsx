"use client";

import { useRef } from "react";
import { createMemoryMailClient } from "@yourtal/mail-engine/testing";
import type { MemoryMailClient } from "@yourtal/mail-engine/testing";
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
 * The real mail screens on the engine's in-memory client, in the real viewer shell. Lab only
 * (`page.lab.tsx`): it is how the rendered gate checks the screens, and how they are looked at,
 * without a mailbox. "Deliver a message" stands in for new mail arriving, so the nav badge can be
 * watched rising.
 */
export function MailLab({ route, locale }: { route: MailRoute; locale: SupportedLocale }) {
  const memory = useRef<MemoryMailClient | null>(null);
  const create = () => {
    memory.current = createMemoryMailClient();
    return memory.current;
  };
  return (
    <MailRoot createClient={create} base={LAB_BASE}>
      <ViewerShell locale={locale} availablePoints={1240} mail={{ on: true }}>
        <PageContainer width="wide" className="py-6">
          <MailShell address={ADDRESS}>
            <MailRoutesView route={route} />
          </MailShell>
          <div className="mt-6">
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={() => memory.current?.deliver({ subject: "A brand new message" })}
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
