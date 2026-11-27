"use client";

import { createContext, useContext, useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { createMailClient } from "@yourtal/mail-engine";
import type { MailClient } from "@yourtal/mail-engine";
import { MailProvider } from "@yourtal/mail-engine/react";
import { MAIL_BASE } from "./mail-routes";
import { sessionFrom } from "./mail-session";
import { mintMailSessionAction } from "./spambank-actions";

/**
 * One mail client for the whole signed-in shell.
 *
 * The (app) shell mounts this when the person has a mailbox, above the top bar, so the unread
 * badge and the mail screens share one engine client: one token, one folders store, one live
 * stream. The engine fetches nothing until a hook subscribes, so it costs nothing on a page that
 * shows no mail. `createClient` is for the lab preview, which passes the in-memory client.
 */
interface RootValue {
  client: MailClient;
  /** Where the mail screens live: `/mail`, or `/lab/mail` in the preview. */
  base: string;
}

const RootContext = createContext<RootValue | null>(null);

export function useMailBase(): string {
  return useContext(RootContext)?.base ?? MAIL_BASE;
}

const defaultClient = (): MailClient =>
  createMailClient({ getSession: () => sessionFrom(mintMailSessionAction) });

export function MailRoot({
  children,
  createClient = defaultClient,
  base = MAIL_BASE,
}: {
  children: ReactNode;
  createClient?: () => MailClient;
  base?: string;
}) {
  const [client] = useState<MailClient>(createClient);
  const mounted = useRef(false);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      // StrictMode runs this cleanup and the effect again on the same client; only a real
      // unmount leaves `mounted` false by the time this timer fires.
      setTimeout(() => {
        if (!mounted.current) client.close();
      }, 0);
    };
  }, [client]);

  const [value] = useState<RootValue>(() => ({ client, base }));
  return (
    <RootContext.Provider value={value}>
      <MailProvider client={client}>{children}</MailProvider>
    </RootContext.Provider>
  );
}
