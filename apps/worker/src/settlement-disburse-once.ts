import { createPaymentProviders } from "@yourtal/drivers/payment-providers";
import { runSettlementDisburse } from "./jobs/settlement-disburse";
import { createPool } from "./pool";

/**
 * One settlement-disburse run, outside pg-boss, configured from the
 * environment exactly as the scheduled job is. The API's payouts end-to-end
 * test runs it as its own process (the API may not import the worker), and
 * an operator can run it by hand. Prints the counts as JSON.
 */
const url = process.env["DATABASE_URL"];
if (url === undefined) throw new Error("DATABASE_URL must be set");
const pool = createPool(url);
try {
  const result = await runSettlementDisburse(
    pool,
    createPaymentProviders(process.env).AU.payoutAccounts,
  );
  process.stdout.write(`${JSON.stringify(result)}\n`);
} finally {
  await pool.end();
}
