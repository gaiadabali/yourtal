"use client";

import { useState } from "react";
import Link from "next/link";
import type { Route } from "next";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import type { PublicListing } from "@yourtal/contracts/listing";
import type { WalletSummary } from "@yourtal/contracts/wallet/wallet";
import type { Points } from "@yourtal/contracts/money";
import { Button } from "@yourtal/ui/button";
import { Badge } from "@yourtal/ui/badge";
import { PriceLockCountdown } from "./price-lock-countdown";
import { BurnSummary } from "./burn-summary";
import { BurnErrorMessage } from "./burn-error-message";
import { classifyBalanceEligibility, recoveryForError, burnErrorFromApiError } from "./burn-errors";
import { confirmCheckoutAction } from "./confirm-checkout-action";
import type { BurnFlowState } from "./burn-flow-state";

export interface BurnFlowProps {
  listing: PublicListing;
  balance: WalletSummary;
  /** The checkout saga `POST /api/checkout/quote` opened — `confirmCheckoutAction` runs it. */
  checkoutId: string;
  /** The REAL, locked price (`CheckoutQuote.pricePoints`) — never re-read from `listing.priceInPoints`, which can move before this quote is confirmed. */
  pricePoints: Points;
  lockExpiresAt: string;
}

/**
 * The client leaf that owns the whole burn flow's interaction
 * (docs/13b-typescript-standards.md section 8 — `page.tsx` stays a Server
 * Component; this is the smallest subtree that needs state and handlers).
 *
 * Rendered with `key={lockExpiresAt}` by `page.tsx`, so a re-quote (a fresh
 * server render after "Muat ulang harga") remounts this component from
 * scratch with a brand-new lock, checkout id and price, instead of a stale
 * `failed`/`lock_expired` state surviving across the new quote.
 */
export function BurnFlow({
  listing,
  balance,
  checkoutId,
  pricePoints,
  lockExpiresAt,
}: BurnFlowProps) {
  const router = useRouter();
  const [state, setState] = useState<BurnFlowState>(() => {
    const initialError = classifyBalanceEligibility(pricePoints, balance);
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

  async function handleConfirm() {
    setState({ step: "submitting" });
    // The real gate: `POST /api/checkout` re-checks the quote's expiry and
    // the caller's actual balance server-side (4.7.a's saga), regardless of
    // what this render last showed — see `confirm-checkout-action.ts`.
    const outcome = await confirmCheckoutAction(checkoutId);
    setState(
      outcome.ok
        ? { step: "success", voucherId: outcome.result.voucherId }
        : { step: "failed", error: burnErrorFromApiError(outcome.error, lockExpiresAt) },
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
        pricePoints={pricePoints}
        storeHref={storeHref}
        onContinue={() => setState({ step: "confirming" })}
        onBack={() => setState({ step: "reviewing" })}
        onConfirm={() => void handleConfirm()}
        onRequote={() => router.refresh()}
      />
    </div>
  );
}

interface BurnFlowStepProps {
  state: BurnFlowState;
  listing: PublicListing;
  pricePoints: Points;
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
  pricePoints,
  storeHref,
  onContinue,
  onBack,
  onConfirm,
  onRequote,
}: BurnFlowStepProps) {
  const t = useTranslations("burn");
  switch (state.step) {
    case "reviewing":
      return (
        <>
          <BurnSummary listing={listing} pricePoints={pricePoints} variant="review" />
          <Button type="button" onClick={onContinue}>
            {t("flow.continue")}
          </Button>
        </>
      );
    case "confirming":
      return (
        <>
          <BurnSummary listing={listing} pricePoints={pricePoints} variant="confirmation" />
          <p className="text-xs font-sans text-fg-subtle">{t("flow.confirmDisclaimer")}</p>
          <div className="flex gap-2">
            <Button type="button" variant="secondary" onClick={onBack} className="flex-1">
              {t("flow.back")}
            </Button>
            <Button type="button" onClick={onConfirm} className="flex-1">
              {t("flow.exchangeNow")}
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
          {t("flow.processing")}
        </div>
      );
    case "success": {
      const voucherHref = `/wallet/voucher/${state.voucherId}` as Route;
      return (
        <div className="flex flex-col gap-3 rounded-lg border border-success bg-success/10 p-4">
          <Badge variant="success" className="w-fit">
            {t("flow.successBadge")}
          </Badge>
          <p className="text-sm font-sans text-fg">
            {t.rich("flow.successMessage", {
              voucherTitle: listing.title,
              merchantName: listing.merchantName,
              bold: (chunks) => <span className="font-semibold">{chunks}</span>,
            })}
          </p>
          <Button asChild>
            <Link href={voucherHref}>{t("flow.viewInWallet")}</Link>
          </Button>
        </div>
      );
    }
    case "failed": {
      const recovery = recoveryForError(state.error);
      return (
        <div className="flex flex-col gap-3">
          <BurnErrorMessage error={state.error} />
          {recovery.kind === "retry" ? (
            <Button type="button" onClick={onConfirm}>
              {t("flow.tryAgain")}
            </Button>
          ) : recovery.kind === "requote" ? (
            <Button type="button" onClick={onRequote}>
              {t("flow.reloadPrice")}
            </Button>
          ) : (
            <Button asChild variant="secondary">
              <Link href={storeHref}>{t("flow.backToStore")}</Link>
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
