"use client";

import { useEffect } from "react";
import { useTranslations } from "next-intl";
import { asDisplayIdr, formatMoney } from "@yourtal/contracts/money/format";
import { Badge } from "@yourtal/ui/badge";
import { Card, CardContent } from "@yourtal/ui/card";
import { useRegion } from "@/features/region/use-region";
import type { CachedVoucherDetail } from "./voucher-detail-cache";
import { readVoucherDetailCache, writeVoucherDetailCache } from "./voucher-detail-cache";
import { QR_ROTATION_INTERVAL_MS } from "./voucher-qr-rotation";
import { useVoucherQrRotation } from "./use-voucher-qr-rotation";
import { VoucherQrCode } from "./voucher-qr-code";
import { VoucherValidityCountdown } from "./voucher-validity-countdown";
import { VoucherArchivedPanel } from "./voucher-archived-panel";
import { classifyVoucherStatus, VOUCHER_STATUS_MESSAGE_KEY } from "./wallet-voucher-status-copy";
import { formatWalletDate } from "./wallet-format";

export interface VoucherDetailViewProps {
  voucherId: string;
  initialDetail: CachedVoucherDetail;
}

/**
 * Client leaf for `/wallet/voucher/[voucherId]` (YT-0424). Cache-first by
 * design: on mount it prefers whatever is already in localStorage for this
 * voucher id over the freshly server-rendered `initialDetail` prop, and
 * every render after that writes the current value back to cache. That
 * makes "renders from cache with the network disabled" a literal, checkable
 * property of this one component — see voucher-detail-view.test.tsx, which
 * seeds the cache, stubs `fetch` to reject, and asserts the component still
 * renders the cached voucher correctly and never calls `fetch`.
 *
 * What this does NOT, on its own, prove: a full offline page load. Getting
 * this component's own HTML/JS shell without a network request needs a
 * service worker — docs/15-stack-locked.md locks Serwist, and it is now
 * installed (`app/sw.ts`, wired in `next.config.ts`) and genuinely caches
 * a visited page's document response (NetworkFirst, `@serwist/next`'s
 * `defaultCache`). The gap that remains, and is NOT this component's to
 * close: Serwist's stable Next.js integration hooks into webpack, and this
 * app's `next build`/`next start` default to Turbopack (Next 16's default,
 * unrelated to this ticket) — under Turbopack, `public/sw.js` is silently
 * never emitted, so the service worker this file's own e2e test proves
 * against a `next build --webpack` run does not yet exist in what
 * `pnpm build` actually ships. See `e2e/offline-voucher-detail.spec.ts` and
 * this ticket's report for the full account. Independent of all of that,
 * this component's own guarantee is unconditionally real: once its JS and
 * a cache entry exist, nothing in its render path — not the voucher data,
 * not the QR payload, not the redemption copy — depends on a network call.
 */
export function VoucherDetailView({ voucherId, initialDetail }: VoucherDetailViewProps) {
  const { locale } = useRegion();
  const t = useTranslations("wallet");
  // Cache-first, not state: this component never mutates the voucher detail
  // itself (a route change unmounts and remounts it for a different id), so
  // a plain read-through beats useState — nothing here would ever call a
  // setter.
  const detail: CachedVoucherDetail = readVoucherDetailCache(voucherId) ?? initialDetail;

  useEffect(() => {
    writeVoucherDetailCache(detail);
  }, [detail]);

  const rotation = useVoucherQrRotation({
    id: detail.id,
    code: detail.code,
    expiresAt: detail.expiresAt,
  });
  const expired = rotation.isExpired;
  // `classifyVoucherStatus` + `VOUCHER_STATUS_MESSAGE_KEY`, not the
  // Server-only `describeVoucherStatus` (see that file's doc comment):
  // this is a Client Component, so the label must come from this
  // component's own `useTranslations("wallet")` — the active locale's
  // catalogue only, already loaded by `NextIntlClientProvider` — never
  // from a helper that statically imports both locales' JSON.
  const statusClassification = classifyVoucherStatus(detail.status, expired);
  const statusLabel = t(VOUCHER_STATUS_MESSAGE_KEY[statusClassification.kind]);
  const isRedeemable = detail.status === "active" && !expired;

  return (
    <div className="flex flex-col gap-6">
      <Card>
        <CardContent className="flex flex-col items-center gap-4 p-6">
          <div className="flex w-full items-start justify-between gap-2">
            <div>
              <p className="text-xs text-fg-subtle">{detail.merchantName}</p>
              <h1 className="text-lg font-semibold text-fg">{detail.title}</h1>
            </div>
            <Badge variant={statusClassification.badgeVariant}>{statusLabel}</Badge>
          </div>

          {isRedeemable ? (
            <>
              <VoucherQrCode
                payload={rotation.payload}
                label={t("voucher.qrLabel", { merchantName: detail.merchantName })}
              />
              <VoucherValidityCountdown
                secondsUntilRotation={rotation.secondsUntilRotation}
                rotationIntervalSeconds={QR_ROTATION_INTERVAL_MS / 1000}
              />
              {/* The code as readable text, not only encoded in the QR above.
                  The merchant portal treats manual entry as a first-class path
                  precisely because cameras fail — bad light, a cracked screen,
                  a browser without BarcodeDetector. Until this was shown, a
                  customer in that situation had nothing to read out and the
                  fallback was unreachable from their side. `select-all` and a
                  monospaced face so it can be read aloud or copied without
                  transcription errors between similar glyphs. */}
              <p className="text-center font-sans text-sm text-fg-muted">
                {t("voucher.manualCodeLabel")}
                <br />
                <span className="select-all font-mono text-lg tracking-widest text-fg">
                  {detail.code}
                </span>
              </p>
            </>
          ) : (
            <VoucherArchivedPanel
              statusLabel={statusLabel}
              dateLabel={t("voucher.expiresOn", {
                date: formatWalletDate(detail.expiresAt, locale),
              })}
            />
          )}

          <dl className="grid w-full grid-cols-2 gap-3 border-t border-border pt-4 text-sm">
            <div>
              <dt className="text-xs text-fg-subtle">{t("voucher.remainingValue")}</dt>
              <dd className="font-semibold text-price">
                {formatMoney(asDisplayIdr(detail.remainingValueMinor), detail.currency)}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-fg-subtle">{t("voucher.validUntilLabel")}</dt>
              <dd className="font-medium text-fg">{formatWalletDate(detail.expiresAt, locale)}</dd>
            </div>
          </dl>

          {/* YT-0583: which branch honours this voucher. Before this, a
              voucher for a multi-branch merchant named the merchant and not
              the outlet, so a user standing in the wrong shop had no way to
              know. `location` is denormalised onto the voucher at issuance,
              so this renders from cache and works offline — which is the
              only state that matters when you are at the counter. */}
          <div className="w-full border-t border-border pt-4">
            <h2 className="text-xs text-fg-subtle">{t("voucher.redeemAtLabel")}</h2>
            <p className="font-medium text-fg">{detail.location.name}</p>
            <p className="text-sm text-fg-muted">{detail.location.address}</p>
            <p className="text-sm text-fg-muted">{detail.location.district}</p>
            <p className="mt-1 text-xs text-fg-subtle">{t("voucher.redeemAtHint")}</p>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="flex flex-col gap-2 p-6">
          <h2 className="text-sm font-semibold text-fg">{t("voucher.howToRedeem")}</h2>
          <p className="text-sm text-fg-muted">{detail.redemptionInstructions}</p>
        </CardContent>
      </Card>
    </div>
  );
}
