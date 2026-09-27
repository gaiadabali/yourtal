"use client";

import { useState, useTransition } from "react";
import type { ApiResult } from "@/lib/api/api-fetch";

export type MeActionStatus =
  | { readonly kind: "idle" }
  | { readonly kind: "pending" }
  | { readonly kind: "success" }
  | { readonly kind: "error"; readonly code: string; readonly message: string };

/**
 * The one bit of UI state every Me widget's "save" button needs (6.7.a):
 * pending while the Server Action is in flight, a brief success
 * confirmation, or an inline error message — never a route change, per
 * `me-actions.ts`'s own doc comment. `run` returns the resolved data on
 * success so a caller can also update its own local optimistic state.
 */
export function useMeActionStatus() {
  const [status, setStatus] = useState<MeActionStatus>({ kind: "idle" });
  const [isPending, startTransition] = useTransition();

  function run<T>(action: () => Promise<ApiResult<T>>, onSuccess?: (data: T) => void) {
    setStatus({ kind: "pending" });
    startTransition(() => {
      void action().then((result) => {
        if (result.ok) {
          setStatus({ kind: "success" });
          onSuccess?.(result.data);
        } else {
          const code = result.error.kind === "http" ? result.error.code : result.error.kind;
          const message =
            result.error.kind === "http"
              ? result.error.message
              : "The request couldn't reach YourTal.";
          setStatus({ kind: "error", code, message });
        }
      });
    });
  }

  return { status, isPending, run };
}
