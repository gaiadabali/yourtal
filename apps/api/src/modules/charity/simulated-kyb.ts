import { createHash } from "node:crypto";
import type { CharityApplicationRequest } from "@yourtal/contracts/charity";

/**
 * 13.21.a: the charity registration and payout-account check. There is no
 * KYB driver in `packages/drivers` yet, so this is a deterministic simulated
 * check inside the module (demo data only, red line 11): an AU ABN must pass
 * the ATO checksum, an ID yayasan needs its deed and fundraising permit, and
 * an account number ending in 0000 is refused, so staff can see a failure.
 * The references stand in for the provider's: the payout reference is where
 * 13.22's captures settle, straight to the charity.
 */
export type KybOutcome =
  | { readonly ok: true; readonly kybReference: string; readonly payoutReference: string }
  | { readonly ok: false; readonly reason: "abn_invalid" | "account_refused" };

const ABN_WEIGHTS = [10, 1, 3, 5, 7, 9, 11, 13, 15, 17, 19];

export function isValidAbn(abn: string): boolean {
  if (!/^\d{11}$/.test(abn)) return false;
  const digits = [...abn].map(Number);
  digits[0] = (digits[0] ?? 0) - 1;
  const sum = digits.reduce((total, digit, i) => total + digit * (ABN_WEIGHTS[i] ?? 0), 0);
  return sum % 89 === 0;
}

export function simulatedCharityKyb(application: CharityApplicationRequest): KybOutcome {
  const { registration, payoutAccount } = application;
  if (registration.kind === "au_acnc" && !isValidAbn(registration.abn)) {
    return { ok: false, reason: "abn_invalid" };
  }
  if (payoutAccount.accountNumber.endsWith("0000")) return { ok: false, reason: "account_refused" };
  const digest = createHash("sha256")
    .update(`${application.region}:${JSON.stringify(registration)}:${payoutAccount.accountNumber}`)
    .digest("hex");
  return {
    ok: true,
    kybReference: `sim_kyb_${digest.slice(0, 16)}`,
    payoutReference: `sim_payout_${digest.slice(16, 32)}`,
  };
}
