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
 * What this does NOT prove: a full offline page load. Getting this
 * component's own HTML/JS shell without a network request needs a service
 * worker (docs/15-stack-locked.md locks Serwist), which is not installed
 * in this ticket. The guarantee here is narrower and still real: once this
 * component's JS and a cache entry exist, nothing in its render path —
 * not the voucher data, not the QR payload, not the redemption copy —
 * depends on a network call.
 */
export function VoucherDetailView({ voucherId, initialDetail }: VoucherDetailViewProps) {
  const { locale, currency } = useRegion();
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
                {formatMoney(asDisplayIdr(detail.remainingValueIdr), currency)}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-fg-subtle">{t("voucher.validUntilLabel")}</dt>
              <dd className="font-medium text-fg">{formatWalletDate(detail.expiresAt, locale)}</dd>
            </div>
          </dl>
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
