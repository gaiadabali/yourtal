import { Logger } from "@nestjs/common";
import type { FastifyInstance } from "fastify";
import type { Pool } from "pg";
import { startPaySimDispatcher } from "@yourtal/paysim/dispatcher";
import { assertPaySimAllowed } from "@yourtal/paysim/gate";
import { createPgPaySimStore } from "@yourtal/paysim/pg-store";
import { registerPaySim } from "@yourtal/paysim/plugin";
import type { PaySimStore } from "@yourtal/paysim/store";
import type { AppConfig } from "../config/app-config";
import { createPool } from "../shared/persistence/create-pool";

export const PAYSIM_PREFIX = "/api/paysim";

const logger = new Logger("PaySim");

/**
 * 5.1.e / F106: mounts the Stripe-speaking payment simulation on the API's own
 * Fastify instance, so Nest's guards, pipes and interceptors never run on its
 * routes. Does nothing unless `PAYSIM_ENABLED=true`, and refuses production.
 * Returns whether it mounted.
 *
 * `store` is for tests; the app uses its own database pool.
 */
export async function mountPaySim(
  fastify: FastifyInstance,
  config: AppConfig,
  store?: PaySimStore,
): Promise<boolean> {
  const sim = config.paysim;
  const stripe = config.stripe;
  if (sim?.enabled !== true || stripe === undefined) return false;
  assertPaySimAllowed(config.appEnv);

  let pool: Pool | undefined;
  let useStore = store;
  if (useStore === undefined) {
    pool = createPool(config.databaseUrl, { max: 5 });
    useStore = createPgPaySimStore(pool);
  }
  const simConfig = {
    appEnv: config.appEnv,
    secretKey: stripe.secretKey,
    webhookSecret: stripe.webhookSecret,
    webhookUrl: sim.webhookUrl,
    publicBaseUrl: sim.publicUrl,
    accountName: sim.accountName,
  };
  await registerPaySim(fastify, { prefix: PAYSIM_PREFIX, store: useStore, config: simConfig });
  const dispatcher = startPaySimDispatcher({
    store: useStore,
    config: simConfig,
    onError: (error) => {
      logger.error(`dispatcher tick failed: ${error instanceof Error ? error.message : "error"}`);
    },
  });
  fastify.addHook("onClose", async () => {
    await dispatcher.stop();
    await pool?.end();
  });
  logger.log(`payment simulation mounted at ${PAYSIM_PREFIX}`);
  return true;
}
