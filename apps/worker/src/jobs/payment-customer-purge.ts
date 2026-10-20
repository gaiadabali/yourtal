import type { Pool } from "pg";
import { purgeDeletedAccountCustomers } from "@yourtal/db/dsar-payment-handlers";
import {
  createPaymentProviders,
  processorCustomerDeleter,
} from "@yourtal/drivers/payment-providers";
import type { PaymentProviders } from "@yourtal/drivers/payment-providers";
import { createPool } from "../pool";
import { defineJob } from "../job";

/**
 * 5.1.h: finishes the deletion of a saved card at the processor. Account deletion deletes the Stripe customer
 * before it erases the card rows, and keeps the rows when Stripe cannot be reached; by then the person's session
 * is gone, so this retries every user-owned customer whose account no longer exists. Idempotent: a customer
 * Stripe has already deleted counts as done.
 */
let pool: Pool | undefined;
let providers: Readonly<Record<"AU" | "ID", PaymentProviders>> | undefined;

export const job = defineJob({
  queue: "payment.customer_purge",
  schedule: "*/30 * * * *",
  async handle(_job, { config }) {
    pool ??= createPool(config.databaseUrl);
    providers ??= createPaymentProviders(process.env);
    await purgeDeletedAccountCustomers(pool, processorCustomerDeleter(providers));
  },
});
