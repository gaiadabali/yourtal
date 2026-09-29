"use client";

import Link from "next/link";
import type { Route } from "next";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Button } from "@yourtal/ui/button";
import { BurnErrorMessage } from "./burn-error-message";
import { recoveryForError, type BurnError } from "./burn-errors";

export interface RedeemQuoteFailurePanelProps {
  error: BurnError;
  storeHref: Route;
}

/**
 * 11.6.b: what `/store/[listingId]/redeem` renders INSTEAD of `BurnFlow`
 * when `quoteCheckout` itself refuses (`region_mismatch`, `audience_blocked`,
 * `listing_unavailable`, or any other 1.2.c code) — there is no checkout to
 * review yet, so this is not one of `BurnFlow`'s own states. Mirrors
 * `burn-flow.tsx`'s own "failed" step markup for a consistent look; kept as
 * its own small component rather than folding a quote failure into
 * `BurnFlowState` (which would need `checkoutId`/`pricePoints`/
 * `lockExpiresAt` to become conditionally absent, for a case that only ever
 * needs a heading, a body and one recovery action).
 */
export function RedeemQuoteFailurePanel({ error, storeHref }: RedeemQuoteFailurePanelProps) {
  const t = useTranslations("burn");
  const router = useRouter();
  const recovery = recoveryForError(error);
  return (
    <div className="flex flex-col gap-3">
      <BurnErrorMessage error={error} />
      {recovery.kind === "back_to_store" ? (
        <Button asChild variant="secondary">
          <Link href={storeHref}>{t("flow.backToStore")}</Link>
        </Button>
      ) : (
        <Button type="button" onClick={() => router.refresh()}>
          {t("flow.tryAgain")}
        </Button>
      )}
    </div>
  );
}
