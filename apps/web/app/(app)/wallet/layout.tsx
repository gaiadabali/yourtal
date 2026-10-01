import type { ReactNode } from "react";
import { ClientMessages } from "@/features/shell/client-messages";

/** 13.4.a: this section's client strings, on top of the app's base set. */
export default function WalletLayout({ children }: { children: ReactNode }) {
  return (
    <ClientMessages namespaces={["wallet", "auction", "charity", "burn"]}>
      {children}
    </ClientMessages>
  );
}
