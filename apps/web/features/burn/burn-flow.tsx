"use client";

import { useState } from "react";
import Link from "next/link";
import type { Route } from "next";
import { useRouter } from "next/navigation";
import type { Listing } from "@yourtal/contracts/listing";
import type { Balance } from "@yourtal/contracts/balance";
import { Button } from "@yourtal/ui/button";
import { Badge } from "@yourtal/ui/badge";
import { PriceLockCountdown } from "./price-lock-countdown";
import { BurnSummary } from "./burn-summary";
import { BurnErrorMessage } from "./burn-error-message";
import { classifyBurnEligibility, recoveryForError } from "./burn-errors";
import { attemptBurn } from "./burn-redemption";
import type { BurnFlowState } from "./burn-flow-state";

export interface BurnFlowProps {
  listing: Listing;
  balance: Balance;
  lockExpiresAt: string;
}

/**
 * The client leaf that owns the whole burn flow's interaction
 * (docs/13b-typescript-standards.md section 8 — `page.tsx` stays a Server
 * Component; this is the smallest subtree that needs state and handlers).
 *
 * Rendered with `key={lockExpiresAt}` by `page.tsx`, so a re-quote (a fresh
 * server render after "Muat ulang harga") remounts this component from
 * scratch with a brand-new lock and a `reviewing` state, instead of a stale
 * `failed`/`lock_expired` state surviving across the new quote.
 */
export function BurnFlow({ listing, balance, lockExpiresAt }: BurnFlowProps) {
  const router = useRouter();
  const [state, setState] = useState<BurnFlowState>(() => {
    const initialError = classifyBurnEligibility(listing, balance);
    return initialError ? { step: "failed", error: initialError } : { step: "reviewing" };
  });

  function handleExpire() {
    setState((current) => {
      // A success or an already-failed submission stands even if the
      // (still-ticking) countdown fires late — never overwrite a resolved
      // outcome with an expiry notice.
      if (current.step === "reviewing" || current.step === "confirming") {
        return { step: "failed", error: { type: "lock_expired", expiredAt: lockExpiresAt } };
      }
      return current;
    });
  }

  function handleConfirm() {
    setState({ step: "submitting" });
    // Re-checks the lock and the balance from scratch — see
    // `burn-redemption.ts`'s doc comment for why this call, not the
    // countdown's last render, is the actual gate.
    const result = attemptBurn({ listing, balance, lockExpiresAt, nowMs: Date.now() });
    setState(
      result.ok
        ? { step: "success", voucher: result.voucher }
        : { step: "failed", error: result.error },
    );
  }

  const storeHref = `/store/${listing.id}` as Route;
  const showsCountdown =
    state.step === "reviewing" || state.step === "confirming" || state.step === "submitting";

  return (
    <div className="flex flex-col gap-4">
      {showsCountdown ? (
        <PriceLockCountdown lockExpiresAt={lockExpiresAt} onExpire={handleExpire} />
      ) : null}
      <BurnFlowStep
        state={state}
        listing={listing}
        storeHref={storeHref}
        onContinue={() => setState({ step: "confirming" })}
        onBack={() => setState({ step: "reviewing" })}
        onConfirm={handleConfirm}
        onRequote={() => router.refresh()}
      />
    </div>
  );
}

interface BurnFlowStepProps {
  state: BurnFlowState;
  listing: Listing;
  storeHref: Route;
  onContinue: () => void;
  onBack: () => void;
  onConfirm: () => void;
  onRequote: () => void;
}

/** Renders the one screen matching the current step. `switch` is exhaustive over `BurnFlowState["step"]` with a `never` default (docs/13b section 4). */
function BurnFlowStep({
  state,
  listing,
  storeHref,
  onContinue,
  onBack,
  onConfirm,
  onRequote,
}: BurnFlowStepProps) {
  switch (state.step) {
    case "reviewing":
      return (
        <>
          <BurnSummary listing={listing} variant="review" />
          <Button type="button" onClick={onContinue}>
            Lanjutkan
          </Button>
        </>
      );
    case "confirming":
      return (
        <>
          <BurnSummary listing={listing} variant="confirmation" />
          <p className="text-xs font-sans text-fg-subtle">
            Dengan menekan &quot;Tukar sekarang&quot;, poin Anda akan langsung dipotong dan tidak
            dapat dibatalkan.
          </p>
          <div className="flex gap-2">
            <Button type="button" variant="secondary" onClick={onBack} className="flex-1">
              Kembali
            </Button>
            <Button type="button" onClick={onConfirm} className="flex-1">
              Tukar sekarang
            </Button>
          </div>
        </>
      );
    case "submitting":
      return (
        <div
          role="status"
          aria-live="polite"
          className="rounded-lg border border-border bg-surface p-6 text-center text-sm font-sans text-fg-muted"
        >
          Memproses penukaran…
        </div>
      );
    case "success":
      return (
        <div className="flex flex-col gap-3 rounded-lg border border-success bg-success/10 p-4">
          <Badge variant="success" className="w-fit">
            Berhasil
          </Badge>
          <p className="text-sm font-sans text-fg">
            Voucher <span className="font-semibold">{state.voucher.title}</span> berhasil ditukar.
            Kode voucher Anda:{" "}
            <span className="font-semibold tabular-nums">{state.voucher.code}</span>
          </p>
          <Button asChild>
            <Link href="/wallet">Lihat di Dompet</Link>
          </Button>
        </div>
      );
    case "failed": {
      const recovery = recoveryForError(state.error);
      return (
        <div className="flex flex-col gap-3">
          <BurnErrorMessage error={state.error} />
          {recovery.kind === "retry" ? (
            <Button type="button" onClick={onConfirm}>
              Coba lagi
            </Button>
          ) : recovery.kind === "requote" ? (
            <Button type="button" onClick={onRequote}>
              Muat ulang harga
            </Button>
          ) : (
            <Button asChild variant="secondary">
              <Link href={storeHref}>Kembali ke Toko</Link>
            </Button>
          )}
        </div>
      );
    }
    default: {
      const exhaustive: never = state;
      return exhaustive;
    }
  }
}
