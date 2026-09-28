/**
 * Minimal end-to-end example: authorize a voucher for less than its full
 * value, then capture what was actually charged. Run with your sandbox
 * credential (see the README's "Getting credentials" section — issued from
 * Studio → Developers, TASKS.md 8.3.a) before ever pointing this at a live
 * key.
 *
 *   MERCHANT_BASE_URL=https://voucher.sandbox.yourtal.example \
 *   MERCHANT_KEY_ID=key_sandbox_... \
 *   MERCHANT_SECRET=... \
 *   VOUCHER_CODE=ABCD1234EFGH5678K \
 *   pnpm --filter @yourtal/sdk-merchant example:authorize-and-capture
 *
 * CURRENCY defaults to AUD; set CURRENCY=IDR alongside an IDR-denominated
 * voucher code and IDR-sized amounts (TASKS.md 8.3.d: this script proves
 * both regions, since B (AU) and the F1 rate never change per currency —
 * only the amounts and the currency tag on the wire do).
 */
import { createMerchantClient } from "../src/client";
import { MerchantApiError, MerchantNetworkError } from "../src/errors";
import type { Currency } from "../src/types";

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Set ${name} before running this example.`);
  return value;
}

function requiredCurrency(value: string | undefined): Currency {
  if (value === undefined || value === "AUD") return "AUD";
  if (value === "IDR") return "IDR";
  throw new Error(`CURRENCY must be AUD or IDR, got ${value}`);
}

async function main(): Promise<void> {
  const client = createMerchantClient({
    baseUrl: requiredEnv("MERCHANT_BASE_URL"),
    keyId: requiredEnv("MERCHANT_KEY_ID"),
    // Studio -> Developers issues `secret` as 64 HEX characters (the wire
    // encoding of the 32 raw bytes services/voucher signs with) -- decode
    // it before use. Passing the hex string itself would sign with the
    // wrong bytes and every call would come back invalid_signature (found
    // running this example for real against a real issued credential,
    // TASKS.md 8.3.d). See the README's "Getting credentials" section.
    secret: Buffer.from(requiredEnv("MERCHANT_SECRET"), "hex"),
  });

  const code = requiredEnv("VOUCHER_CODE");
  const currency = requiredCurrency(process.env["CURRENCY"]);
  // A real till reads this off the receipt/basket total, never hardcodes it.
  const orderTotalMinor = currency === "IDR" ? 50_000 : 5000;
  const amountToRedeemMinor = currency === "IDR" ? 30_000 : 3000;

  console.log(
    `Authorizing ${code} for ${amountToRedeemMinor} ${currency} of an order totalling ${orderTotalMinor}...`,
  );
  const authorization = await client.authorize({
    code,
    amountMinor: amountToRedeemMinor,
    currency,
    merchantOrderRef: `example-${Date.now()}`,
    orderTotalMinor,
  });
  console.log("Authorized:", authorization);

  // A real till captures once the sale is actually rung up — often the
  // same amount as authorized, sometimes less (the customer removed an
  // item), never more.
  console.log(`Capturing authorization ${authorization.authorizationId}...`);
  const capture = await client.capture({
    authorizationId: authorization.authorizationId,
    finalAmountMinor: amountToRedeemMinor,
  });
  console.log("Captured:", capture);
}

main().catch((error: unknown) => {
  if (error instanceof MerchantApiError) {
    console.error(`Voucher API error [${error.code}]: ${error.message}`);
  } else if (error instanceof MerchantNetworkError) {
    console.error(`Network error talking to the voucher service: ${error.message}`);
  } else {
    console.error(error);
  }
  process.exitCode = 1;
});
