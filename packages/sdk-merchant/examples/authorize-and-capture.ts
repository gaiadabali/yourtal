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
 */
import { createMerchantClient } from "../src/client";
import { MerchantApiError, MerchantNetworkError } from "../src/errors";

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Set ${name} before running this example.`);
  return value;
}

async function main(): Promise<void> {
  const client = createMerchantClient({
    baseUrl: requiredEnv("MERCHANT_BASE_URL"),
    keyId: requiredEnv("MERCHANT_KEY_ID"),
    secret: requiredEnv("MERCHANT_SECRET"),
  });

  const code = requiredEnv("VOUCHER_CODE");
  // A real till reads this off the receipt/basket total, never hardcodes it.
  const orderTotalMinor = 5000;
  const amountToRedeemMinor = 3000;

  console.log(
    `Authorizing ${code} for ${amountToRedeemMinor} of an order totalling ${orderTotalMinor}...`,
  );
  const authorization = await client.authorize({
    code,
    amountMinor: amountToRedeemMinor,
    currency: "AUD",
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
