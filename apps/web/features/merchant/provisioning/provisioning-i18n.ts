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
/**
 * TASKS.md 8.1/8.2 REWRITE: revocation and the devices roster moved to
 * Studio → Team → Devices (`apps/web/features/studio/studio-devices-*`) —
 * `/merchant/devices`'s unauthenticated revoke is deleted outright, not
 * replaced, so the copy that screen used (`revokedHeading`/`revokedBody`/
 * `devicesHeading`/`devicesThisDevice`/`revokeButton`/`revokedBadge`) is
 * gone with it.
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
  };
}

export type ProvisioningFormErrorCode = "invalid_code" | "revoked";

export interface ProvisioningFormCopy {
  heading: string;
  intro: string;
  codeLabel: string;
  submitButton: string;
  errors: Record<ProvisioningFormErrorCode, string>;
}

/**
 * Copy for the pairing form (`/merchant/pair`), always in a single
 * language — see this file's doc comment for why the caller passes
 * `"en-AU"`, not a device locale that does not exist yet.
 *
 * TASKS.md 8.1/8.2 REWRITE: the PIN is chosen by the Admin who provisions
 * the device in Studio (`ProvisionDeviceRequest.pin`), not by whoever
 * physically pairs it — this form now asks only for the pairing code
 * itself. `revoked` covers the one case `unlockWithPin` can discover after
 * the fact: a credential that was valid at pairing time but has since been
 * revoked from Studio, which un-pairs this browser and sends it back here.
 */
export function getProvisioningFormCopy(locale: MerchantLocale): ProvisioningFormCopy {
  const t = getMerchantTranslator(locale);
  return {
    heading: t("provisioning.form.heading"),
    intro: t("provisioning.form.intro"),
    codeLabel: t("provisioning.form.codeLabel"),
    submitButton: t("provisioning.form.submitButton"),
    errors: {
      invalid_code: t("provisioning.form.errors.invalidCode"),
      revoked: t("provisioning.form.errors.revoked"),
    },
  };
}
