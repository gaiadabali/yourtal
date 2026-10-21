"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import type { ConnectActionResult } from "./connect-actions";
import { navigateTo } from "./connect-navigate";

/**
 * Runs one of the connect Server Actions and does what it says: navigate to
 * `redirectTo` (the button stays disabled while the browser leaves), refresh
 * the page for anything that changed the sign-in under the person, or show
 * that it failed. One action at a time, so a double tap cannot post twice.
 */
export function useConnectAction() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  async function run(action: () => Promise<ConnectActionResult>): Promise<void> {
    if (busy) return;
    setBusy(true);
    setFailed(false);
    let result: ConnectActionResult;
    try {
      result = await action();
    } catch {
      result = { kind: "error" };
    }
    if (result.kind === "redirect") {
      navigateTo(result.redirectTo);
      return;
    }
    if (result.kind === "reload") router.refresh();
    else setFailed(true);
    setBusy(false);
  }

  return { busy, failed, run };
}
