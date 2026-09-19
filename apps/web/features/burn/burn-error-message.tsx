"use client";

import { useTranslations } from "next-intl";
import { asDisplayPoints, formatPoints } from "@yourtal/contracts/money/format";
import { useRegion } from "@/features/region/use-region";
import type { BurnError } from "./burn-errors";

export interface BurnErrorMessageProps {
  error: BurnError;
}

/** `Translator` for the `burn` namespace — see `next-intl`'s `useTranslations`. */
type BurnTranslator = ReturnType<typeof useTranslations<"burn">>;

function formatUnlockDateTime(iso: string, locale: "en-AU" | "id-ID"): string {
  return new Intl.DateTimeFormat(locale, { dateStyle: "full", timeStyle: "short" }).format(
    new Date(iso),
  );
}

interface ErrorCopy {
  heading: string;
  body: string;
}

function copyFor(error: BurnError, t: BurnTranslator, locale: "en-AU" | "id-ID"): ErrorCopy {
  switch (error.type) {
    case "insufficient_points":
      return {
        heading: t("error.insufficientHeading"),
        body: t("error.insufficientBody", {
          amount: formatPoints(asDisplayPoints(error.short), locale),
        }),
      };
    case "holdback_blocks":
      // Plain language, no transaction jargon (docs/tasks/phase-u-ui.md
      // YT-0422's fourth acceptance criterion): says WHEN the points unlock
      // and WHY they are held, per the holdback's actual purpose
      // (docs/02-architecture.md: "Fraud detection is statistical and
      // lags the event" — the delay is what turns a stolen balance into a
      // clawback instead of a loss). Both `burn.json` catalogues are kept
      // free of "holdback"/"settlement"/"authorize"/"capture"/"ledger" —
      // `burn-error-message.test.tsx` asserts this for both locales.
      return {
        heading: t("error.holdbackHeading"),
        body: t("error.holdbackBody", {
          unlockDate: formatUnlockDateTime(error.unlocksAt, locale),
        }),
      };
    case "lock_expired":
      return {
        heading: t("error.lockExpiredHeading"),
        body: t("error.lockExpiredBody", {
          expiredDate: formatUnlockDateTime(error.expiredAt, locale),
        }),
      };
    case "listing_unavailable":
      return {
        heading: t("error.listingUnavailableHeading"),
        body: t("error.listingUnavailableBody"),
      };
    case "redemption_failed":
      return {
        heading: t("error.redemptionFailedHeading"),
        body: t("error.redemptionFailedBody"),
      };
    default: {
      const exhaustive: never = error;
      return exhaustive;
    }
  }
}

/**
 * Plain-language, jargon-free copy for every reason a redemption can be
 * blocked (docs/tasks/phase-u-ui.md YT-0422's fourth acceptance criterion —
 * "Holdback explained in plain language when it blocks a redemption").
 * `copyFor` switches exhaustively over `BurnError["type"]` with a `never`
 * default (docs/13b section 4): adding a new `BurnError` variant without
 * adding copy here fails the build instead of silently rendering a blank
 * message.
 *
 * YT-0405: a Client Component (its only consumer, `burn-flow.tsx`, is
 * already `"use client"`), so it reads the active region and its
 * translations ambiently via `useRegion()`/`useTranslations()` — no locale
 * prop, no prop-drilling, real end-to-end wiring through the
 * `RegionProvider`/`NextIntlClientProvider` pair mounted once in
 * `app/(app)/layout.tsx`.
 */
export function BurnErrorMessage({ error }: BurnErrorMessageProps) {
  const { locale } = useRegion();
  const t = useTranslations("burn");
  const { heading, body } = copyFor(error, t, locale);
  return (
    <div
      role="alert"
      className="flex flex-col gap-1 rounded-lg border border-danger bg-danger/10 p-4"
    >
      <p className="text-sm font-sans font-semibold text-danger">{heading}</p>
      <p className="text-sm font-sans text-fg">{body}</p>
    </div>
  );
}
