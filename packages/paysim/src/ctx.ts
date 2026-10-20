import type { PaySimConfig } from "./config";
import type { PaySimTx } from "./store";

/** What a handler knows about the request it runs for. */
export interface Ctx {
  tx: PaySimTx;
  now: Date;
  config: PaySimConfig;
  apiVersion: string;
  idempotencyKey: string | null;
  /** `Stripe-Account` scope; null for the platform. */
  account: string | null;
}

export const unix = (d: Date): number => Math.floor(d.getTime() / 1000);
