import { createTranslator } from "next-intl";
import enAU from "@/messages/en-AU/merchant.json";
import idID from "@/messages/id-ID/merchant.json";
import type { MerchantLocale } from "./merchant-device";

const CATALOGUES = { "en-AU": enAU, "id-ID": idID } satisfies Record<MerchantLocale, typeof idID>;

/**
 * Synchronous translator for the `merchant` namespace, keyed by the DEVICE's
 * own locale (`MerchantDevice.locale`), never the viewer's region cookie —
 * a counter device belongs to one shop in one region regardless of who is
 * standing at it. Same reasoning as `features/wallet/wallet-i18n.ts`'s
 * `getWalletTranslator`: deliberately `createTranslator`, not
 * `getTranslations()`/`useTranslations()`, since both of those resolve
 * `messages` from `i18n/request.ts`'s request config, which reads the
 * REGION cookie via `next/headers` — exactly the source this feature must
 * not use, and unavailable outside a real Next.js request in any case
 * (Vitest calls these components directly, with no request scope).
 */
export function getMerchantTranslator(locale: MerchantLocale) {
  return createTranslator({
    locale,
    messages: { merchant: CATALOGUES[locale] },
    namespace: "merchant",
  });
}

/**
 * Static, staff-facing chrome copy for the redemption portal, resolved once
 * per screen from `merchant.portal.*` and passed down as plain string props
 * (docs/17-surfaces-and-roles.md: "Australia is the real market and
 * Indonesia is the proving ground"). One language per render, from the
 * device's own locale — never both languages at once.
 *
 * Plain language throughout, no transaction jargon (docs/17 §2.2: casual
 * staff, no attentive-owner-at-a-desk assumptions).
 */
export interface MerchantCopy {
  portalHeading: string;
  deviceBadgePrefix: string;
  deviceLocationPrefix: string;
  tabScan: string;
  tabManual: string;
  manualCodeLabel: string;
  manualCodeHelp: string;
  manualCodePlaceholder: string;
  lookUpButton: string;
  scanHint: string;
  scanUnavailable: string;
  scanPermissionDenied: string;
  scanNoCamera: string;
  switchToManual: string;
  notFoundHeading: string;
  notFoundBody: string;
  unreadableHeading: string;
  unreadableBody: string;
  tryAgainButton: string;
  amountLabel: string;
  amountHelp: string;
  confirmButton: string;
  backButton: string;
  processingAuthorize: string;
  processingCapture: string;
  successHeading: string;
  queuedHeading: string;
  queuedBody: string;
  newRedemptionButton: string;
  offlineLabel: string;
  syncingLabel: string;
  offlineBanner: string;
  backOnlineBanner: string;
  syncingBanner: string;
  todayHeading: string;
  todayTotalLabel: string;
  todayPendingLabel: string;
  todayEmpty: string;
  todayStatusPending: string;
  todayStatusFailed: string;
  /** YT-0583 follow-up: the outcome panel's "remaining voucher value" prefix — previously a hardcoded `locale === "id-ID" ? … : …` ternary in `merchant-outcome-panel.tsx`. */
  remainingValueLabel: string;
}

export function getMerchantCopy(locale: MerchantLocale): MerchantCopy {
  const t = getMerchantTranslator(locale);
  return {
    portalHeading: t("portal.portalHeading"),
    deviceBadgePrefix: t("portal.deviceBadgePrefix"),
    deviceLocationPrefix: t("portal.deviceLocationPrefix"),
    tabScan: t("portal.tabScan"),
    tabManual: t("portal.tabManual"),
    manualCodeLabel: t("portal.manualCodeLabel"),
    manualCodeHelp: t("portal.manualCodeHelp"),
    manualCodePlaceholder: t("portal.manualCodePlaceholder"),
    lookUpButton: t("portal.lookUpButton"),
    scanHint: t("portal.scanHint"),
    scanUnavailable: t("portal.scanUnavailable"),
    scanPermissionDenied: t("portal.scanPermissionDenied"),
    scanNoCamera: t("portal.scanNoCamera"),
    switchToManual: t("portal.switchToManual"),
    notFoundHeading: t("portal.notFoundHeading"),
    notFoundBody: t("portal.notFoundBody"),
    unreadableHeading: t("portal.unreadableHeading"),
    unreadableBody: t("portal.unreadableBody"),
    tryAgainButton: t("portal.tryAgainButton"),
    amountLabel: t("portal.amountLabel"),
    amountHelp: t("portal.amountHelp"),
    confirmButton: t("portal.confirmButton"),
    backButton: t("portal.backButton"),
    processingAuthorize: t("portal.processingAuthorize"),
    processingCapture: t("portal.processingCapture"),
    successHeading: t("portal.successHeading"),
    queuedHeading: t("portal.queuedHeading"),
    queuedBody: t("portal.queuedBody"),
    newRedemptionButton: t("portal.newRedemptionButton"),
    offlineLabel: t("portal.offlineLabel"),
    syncingLabel: t("portal.syncingLabel"),
    offlineBanner: t("portal.offlineBanner"),
    backOnlineBanner: t("portal.backOnlineBanner"),
    syncingBanner: t("portal.syncingBanner"),
    todayHeading: t("portal.todayHeading"),
    todayTotalLabel: t("portal.todayTotalLabel"),
    todayPendingLabel: t("portal.todayPendingLabel"),
    todayEmpty: t("portal.todayEmpty"),
    todayStatusPending: t("portal.todayStatusPending"),
    todayStatusFailed: t("portal.todayStatusFailed"),
    remainingValueLabel: t("portal.remainingValueLabel"),
  };
}
