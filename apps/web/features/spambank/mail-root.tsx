"use client";

import { createContext, useContext } from "react";
import type { ReactNode } from "react";
import type { MailClient } from "@yourtal/mail-engine";
import { MailProvider } from "@yourtal/mail-engine/react";
import { sharedMailClient } from "./mail-client";
import { MAIL_BASE } from "./mail-routes";

/**
 * Gives the mail screens the tab's shared client and says where they live: `/mail`, or `/lab/mail`
 * in the preview. `client` is for tests.
 */
const BaseContext = createContext<string>(MAIL_BASE);

export function useMailBase(): string {
  return useContext(BaseContext);
}

export function MailRoot({
  children,
  client,
  base = MAIL_BASE,
}: {
  children: ReactNode;
  client?: MailClient;
  base?: string;
}) {
  return (
    <BaseContext.Provider value={base}>
      <MailProvider client={client ?? sharedMailClient()}>{children}</MailProvider>
    </BaseContext.Provider>
  );
}
