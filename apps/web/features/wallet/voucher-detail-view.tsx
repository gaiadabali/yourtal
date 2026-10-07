"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { useTranslations } from "next-intl";
import type { DisputeResult } from "@yourtal/contracts/checkout/dispute";
import { MoneyAmount } from "@yourtal/ui/money-amount";
import { StatusBadge } from "@yourtal/ui/status-badge";
import { Heading } from "@yourtal/ui/heading";
import { Text } from "@yourtal/ui/text";
import { KeyValue } from "@yourtal/ui/key-value";
import { Notice } from "@yourtal/ui/notice";
import { useRegion } from "@/features/region/use-region";
import type { CachedVoucherDetail } from "./voucher-detail-cache";
import { readVoucherDetailCache, writeVoucherDetailCache } from "./voucher-detail-cache";
import type { WalletQrDetail } from "./wallet-data";
import { useVoucherCode } from "./use-voucher-code";
import { useVoucherQrRotation } from "./use-voucher-qr-rotation";
import { VoucherQrCode } from "./voucher-qr-code";
import { VoucherValidityCountdown } from "./voucher-validity-countdown";
import { VoucherArchivedPanel } from "./voucher-archived-panel";
import { VoucherDisputeButton } from "./voucher-dispute-button";
import { VoucherGiftButton } from "./voucher-gift-button";
import type { PublicCharity } from "@yourtal/contracts/charity/charity";
import { ListForCharityButton } from "@/features/auction/list-for-charity-button";
import {
  describeVoucherStatus,
  isVoucherEffectivelyExpired,
  isVoucherRedeemable,
} from "./wallet-voucher-status-copy";
import { buildRedemptionInstructions } from "./wallet-redemption-copy";
import { formatWalletDate } from "./wallet-format";

export interface VoucherDetailViewProps {
  voucherId: string;
  initialDetail: CachedVoucherDetail;
  /** Only present when the voucher is in a redeemable (held/active) state — see the route's `page.tsx`. */
  initialQr: WalletQrDetail | null;
  /** 13.20.c: show the Gift action (the server's own `giftable`). */
  giftable?: boolean;
  /** 13.22.d: charities to list this voucher for; omitted, no auction action. */
  charities?: readonly PublicCharity[];
}

/** True while the browser reports itself offline — 6.5.c: "shows with the network off". */
function useIsOffline(): boolean {
  return useSyncExternalStore(
    (onChange) => {
      window.addEventListener("online", onChange);
      window.addEventListener("offline", onChange);
      return () => {
        window.removeEventListener("online", onChange);
        window.removeEventListener("offline", onChange);
      };
    },
    () => !navigator.onLine,
    () => false,
  );
}

/**
 * Client leaf for `/wallet/voucher/[voucherId]` (6.5.b). Cache-first by
 * design: on mount it prefers whatever is already in localStorage for this
 * voucher id over the freshly server-rendered `initialDetail` prop, so the
 * page renders correctly with the network off once it has been visited
 * once (6.5.c). The QR itself has its own, separate IndexedDB cache
 * (`use-voucher-qr-rotation.ts`) because it needs a full hour of rotating
 * tokens, not one small record.
 */
export function VoucherDetailView({
  voucherId,
  initialDetail,
  initialQr,
  giftable = false,
  charities,
}: VoucherDetailViewProps) {
  const { locale } = useRegion();
  const t = useTranslations("wallet");
  const isOffline = useIsOffline();
  const [disputeOutcome, setDisputeOutcome] = useState<
    { ok: true; result: DisputeResult } | { ok: false } | null
  >(null);

  const detail: CachedVoucherDetail = readVoucherDetailCache(voucherId) ?? initialDetail;

  useEffect(() => {
    writeVoucherDetailCache(detail);
    // Only re-runs when the cached values actually change identity, not on
    // every render — `detail` is a plain object read fresh each render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [detail.voucherId, detail.state, detail.status, detail.cachedAt]);

  const expired = isVoucherEffectivelyExpired(detail.expiresAt, Date.now());
  const statusCopy = describeVoucherStatus(detail.state, expired, t, detail.status);
  const isRedeemable = isVoucherRedeemable(detail, Date.now());
  // Voided: nothing left to spend, so none of the spending details apply.
  const isVoid = statusCopy.kind === "void";

  // Memory only, and only while online: offline renders show the QR alone.
  const code = useVoucherCode(voucherId, isRedeemable && !isOffline);

  // The hook must always run (rules of hooks) — `initialQr` is null for an
  // already-archived voucher, so it is handed an inert placeholder that
  // never rotates. Nothing reads `rotation` in that branch below.
  const rotation = useVoucherQrRotation(
    voucherId,
    initialQr ?? { voucherId, token: "", expiresAt: new Date(0).toISOString() },
  );

  return (
    <div className="flex flex-col gap-6">
      {isOffline ? <Notice tone="info">{t("voucher.offlineNotice")}</Notice> : null}
      {disputeOutcome ? (
        <Notice tone={disputeOutcome.ok ? "success" : "danger"}>
          {disputeOutcome.ok
            ? disputeOutcome.result.outcome === "reinstated"
              ? t("voucher.disputeReinstated")
              : t("voucher.disputeQueued")
            : t("voucher.disputeFailed")}
        </Notice>
      ) : null}

      <div className="flex flex-col items-center gap-4 rounded-card border border-border-subtle bg-surface p-6">
        <div className="flex w-full items-start justify-between gap-2">
          <div>
            {detail.merchantName ? (
              <Text tone="muted" size="body-sm">
                {detail.merchantName}
              </Text>
            ) : null}
            <Heading level={1} size="title">
              {detail.title ?? t("voucher.genericTitle")}
            </Heading>
          </div>
          <StatusBadge status={statusCopy.badgeStatus}>{statusCopy.label}</StatusBadge>
        </div>

        {isRedeemable && initialQr ? (
          <>
            {rotation.current ? (
              <>
                <VoucherQrCode
                  payload={rotation.current.token}
                  label={t("voucher.qrLabel", { merchantName: detail.merchantName ?? "" })}
                  code={code ?? "—"}
                  caption={code ? undefined : t("voucher.codeUnavailable")}
                  fallbackLabel={t("voucher.qrRenderFailed")}
                />
                <VoucherValidityCountdown
                  secondsUntilRotation={rotation.secondsUntilRotation}
                  rotationIntervalSeconds={300}
                />
              </>
            ) : (
              <Notice tone={rotation.refreshFailed ? "warning" : "info"}>
                {rotation.refreshFailed ? t("voucher.qrExpiredOffline") : t("voucher.qrRefreshing")}
              </Notice>
            )}
            <div className="flex flex-wrap gap-2">
              {giftable ? <VoucherGiftButton voucherId={voucherId} locale={locale} /> : null}
              {giftable && charities ? (
                <ListForCharityButton voucherId={voucherId} charities={charities} />
              ) : null}
              <VoucherDisputeButton voucherId={voucherId} onResolved={setDisputeOutcome} />
            </div>
          </>
        ) : (
          <VoucherArchivedPanel
            statusLabel={statusCopy.label}
            dateLabel={
              isVoid
                ? t("voucher.voidHint")
                : statusCopy.kind === "expired" && detail.expiresAt
                  ? t("voucher.expiresOn", { date: formatWalletDate(detail.expiresAt, locale) })
                  : ""
            }
          />
        )}

        {isVoid
          ? null
          : (() => {
              const items = [
                ...(detail.remainingValueMinor !== undefined && detail.currency
                  ? [
                      {
                        key: "remaining",
                        label: t("voucher.remainingValue"),
                        value: (
                          <MoneyAmount
                            amountMinor={detail.remainingValueMinor}
                            currency={detail.currency}
                            locale={locale}
                          />
                        ),
                      },
                    ]
                  : []),
                ...(detail.expiresAt
                  ? [
                      {
                        key: "validUntil",
                        label: t("voucher.validUntilLabel"),
                        value: formatWalletDate(detail.expiresAt, locale),
                      },
                    ]
                  : []),
              ];
              return items.length > 0 ? (
                <KeyValue items={items} className="w-full border-t border-border pt-4" />
              ) : null;
            })()}

        {detail.location && !isVoid ? (
          <div className="w-full border-t border-border pt-4">
            <h2 className="text-caption text-fg-subtle">{t("voucher.redeemAtLabel")}</h2>
            <p className="font-sans text-body font-medium text-fg">{detail.location.name}</p>
            <p className="text-body-sm text-fg-muted">{detail.location.address}</p>
            <p className="text-body-sm text-fg-muted">{detail.location.district}</p>
            <p className="mt-1 text-caption text-fg-subtle">{t("voucher.redeemAtHint")}</p>
          </div>
        ) : null}
      </div>

      {isVoid ? null : (
        <div className="flex flex-col gap-2 rounded-card border border-border-subtle bg-surface p-6">
          <Heading level={2} size="title">
            {t("voucher.howToRedeem")}
          </Heading>
          <Text tone="muted">
            {detail.merchantName && detail.partialRedemptionPolicy
              ? buildRedemptionInstructions(detail.merchantName, detail.partialRedemptionPolicy, t)
              : t("voucher.genericInstructions")}
          </Text>
        </div>
      )}
    </div>
  );
}
