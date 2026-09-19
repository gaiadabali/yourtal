import type { MerchantLocale } from "../merchant-device";

/**
 * Locale copy for everything AFTER provisioning — the PIN-unlock screen,
 * the lock chrome, and revoked-device messaging — where `device.locale` is
 * already known, same pattern as `../merchant-copy.ts`.
 *
 * The provisioning form itself (`device-provisioning-form.tsx`) is the one
 * exception: no device, and therefore no locale, exists yet at that point,
 * so it follows `apps/web/features/onboarding/region-picker.tsx`'s
 * established convention instead — both languages shown together, plainly,
 * rather than switched by a locale nobody has picked. `PROVISIONING_FORM_TEXT`
 * below is that bilingual copy.
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

const idID: ProvisioningCopy = {
  unlockHeading: "Buka kunci perangkat",
  unlockPinHelp:
    "PIN ini hanya mengunci layar perangkat ini selama tidak dipakai — bukan akun pribadi. Siapa pun di toko yang tahu PIN ini boleh memakainya.",
  pinLabel: "PIN",
  unlockButton: "Buka kunci",
  lockButton: "Kunci sekarang",
  lockedByDeviceLabel: "Perangkat",
  errorWrongPin: "PIN salah. Coba lagi.",
  errorTooManyAttempts: "Terlalu banyak percobaan salah. Tunggu sebentar lalu coba lagi.",
  revokedHeading: "Perangkat ini telah dicabut",
  revokedBody:
    "Admin toko telah mencabut akses perangkat ini. Hubungi Admin untuk mendapatkan kode pemasangan baru.",
  devicesHeading: "Perangkat yang terdaftar",
  devicesThisDevice: "(perangkat ini)",
  revokeButton: "Cabut akses",
  revokedBadge: "Dicabut",
};

const enAU: ProvisioningCopy = {
  unlockHeading: "Unlock this device",
  unlockPinHelp:
    "This PIN only locks this device's screen while it's not in use — it isn't a personal account. Anyone at the shop who knows it can use it.",
  pinLabel: "PIN",
  unlockButton: "Unlock",
  lockButton: "Lock now",
  lockedByDeviceLabel: "Device",
  errorWrongPin: "Wrong PIN. Try again.",
  errorTooManyAttempts: "Too many wrong attempts. Wait a moment and try again.",
  revokedHeading: "This device has been revoked",
  revokedBody:
    "Your business's Admin has revoked this device's access. Contact your Admin for a new pairing code.",
  devicesHeading: "Registered devices",
  devicesThisDevice: "(this device)",
  revokeButton: "Revoke access",
  revokedBadge: "Revoked",
};

const PROVISIONING_COPY: Record<MerchantLocale, ProvisioningCopy> = {
  "id-ID": idID,
  "en-AU": enAU,
};

export function getProvisioningCopy(locale: MerchantLocale): ProvisioningCopy {
  return PROVISIONING_COPY[locale];
}

export type ProvisioningFormErrorCode = "invalid_code" | "pin_invalid" | "pin_mismatch";

/**
 * Bilingual, always-both-languages copy for the pre-provisioning form —
 * see this file's doc comment for why no single locale is chosen here.
 */
export const PROVISIONING_FORM_TEXT = {
  heading: { en: "Set up this device", id: "Siapkan perangkat ini" },
  intro: {
    en: "Ask your business's Admin for a provisioning code — it's generated from the Team zone of the business console and binds this device to one shop location.",
    id: "Minta kode pemasangan dari Admin bisnis kamu — kode ini dibuat dari zona Tim di konsol bisnis dan mengikat perangkat ini ke satu lokasi toko.",
  },
  codeLabel: { en: "Provisioning code", id: "Kode pemasangan" },
  pinLabel: { en: "Choose a 4–6 digit PIN", id: "Pilih PIN 4–6 digit" },
  pinHelp: {
    en: "This PIN just locks the screen for this shift — anyone who works this counter should be comfortable using it. It is not a password.",
    id: "PIN ini hanya mengunci layar untuk shift ini — siapa pun yang bertugas di kasir ini boleh memakainya. Ini bukan kata sandi.",
  },
  confirmPinLabel: { en: "Confirm PIN", id: "Konfirmasi PIN" },
  submitButton: { en: "Pair this device", id: "Pasangkan perangkat ini" },
  errors: {
    invalid_code: {
      en: "That code wasn't recognised. Check it with your Admin.",
      id: "Kode tidak dikenali. Periksa kembali dengan Admin.",
    },
    pin_invalid: { en: "PIN must be 4–6 digits.", id: "PIN harus 4–6 digit." },
    pin_mismatch: { en: "The two PINs don't match.", id: "Kedua PIN tidak cocok." },
  } satisfies Record<ProvisioningFormErrorCode, { en: string; id: string }>,
} as const;
