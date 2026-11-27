"use client";

import type { ReactNode } from "react";
import { MailRoot } from "./mail-root";
import { MailShell } from "./mail-shell";

/** The mail screens' frame with the shared client: loaded on its own (`mail-lazy.tsx`). */
export default function MailFrame({ address, children }: { address: string; children: ReactNode }) {
  return (
    <MailRoot>
      <MailShell address={address}>{children}</MailShell>
    </MailRoot>
  );
}
