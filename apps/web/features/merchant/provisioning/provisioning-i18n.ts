import { getMerchantTranslator } from "../merchant-i18n";
import type { MerchantLocale } from "../merchant-device";

/**
 * Locale copy for everything AFTER provisioning — the PIN-unlock screen,
 * the lock chrome, and revoked-device messaging — where `device.locale` is
 * already known, resolved from `merchant.provisioning.*` via the same
 * device-locale `getMerchantTranslator` as `../merchant-i18n.ts`'s portal
 * copy.
 *
 * The provisioning form itself (`device-provisioning-form.tsx`) is the one
 * exception: no device, and therefore no locale, exists yet at that point.
 * It now renders `getProvisioningFormCopy("en-AU")` — one language, the
 * project default (docs/16, "English (en-AU) is the default") — rather than
 * this repo's earlier both-languages-stacked convention for that same gap
 * (see YT-0446's original comment, and `region-picker.tsx`, which still
 * does that for the one screen that predates any locale AND any region).
 */
export interface ProvisioningCopy {
  unlockHeading: string;
  unlockPinHelp: string;
  pinLabel: string;
  unlockButton: string;
  lockButton: string;
  lockedByDeviceLabel: string;
  errorWrongPin: string;
  errorTooManyAttempts: string;
  revokedHeading: string;
  revokedBody: string;
  devicesHeading: string;
  devicesThisDevice: string;
  revokeButton: string;
  revokedBadge: string;
}

export function getProvisioningCopy(locale: MerchantLocale): ProvisioningCopy {
  const t = getMerchantTranslator(locale);
  return {
    unlockHeading: t("provisioning.unlockHeading"),
    unlockPinHelp: t("provisioning.unlockPinHelp"),
    pinLabel: t("provisioning.pinLabel"),
    unlockButton: t("provisioning.unlockButton"),
    lockButton: t("provisioning.lockButton"),
    lockedByDeviceLabel: t("provisioning.lockedByDeviceLabel"),
    errorWrongPin: t("provisioning.errorWrongPin"),
    errorTooManyAttempts: t("provisioning.errorTooManyAttempts"),
    revokedHeading: t("provisioning.revokedHeading"),
    revokedBody: t("provisioning.revokedBody"),
    devicesHeading: t("provisioning.devicesHeading"),
    devicesThisDevice: t("provisioning.devicesThisDevice"),
    revokeButton: t("provisioning.revokeButton"),
    revokedBadge: t("provisioning.revokedBadge"),
  };
}

export type ProvisioningFormErrorCode = "invalid_code" | "pin_invalid" | "pin_mismatch";

export interface ProvisioningFormCopy {
  heading: string;
  intro: string;
  codeLabel: string;
  pinLabel: string;
  pinHelp: string;
  confirmPinLabel: string;
  submitButton: string;
  errors: Record<ProvisioningFormErrorCode, string>;
}

/**
 * Copy for the pre-pairing form, always in a single language — see this
 * file's doc comment for why the caller passes `"en-AU"`, not a device
 * locale that does not exist yet.
 */
export function getProvisioningFormCopy(locale: MerchantLocale): ProvisioningFormCopy {
  const t = getMerchantTranslator(locale);
  return {
    heading: t("provisioning.form.heading"),
    intro: t("provisioning.form.intro"),
    codeLabel: t("provisioning.form.codeLabel"),
    pinLabel: t("provisioning.form.pinLabel"),
    pinHelp: t("provisioning.form.pinHelp"),
    confirmPinLabel: t("provisioning.form.confirmPinLabel"),
    submitButton: t("provisioning.form.submitButton"),
    errors: {
      invalid_code: t("provisioning.form.errors.invalidCode"),
      pin_invalid: t("provisioning.form.errors.pinInvalid"),
      pin_mismatch: t("provisioning.form.errors.pinMismatch"),
    },
  };
}
