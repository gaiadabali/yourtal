import { Logger } from "@nestjs/common";
import { createQueueClient } from "@yourtal/queue/client";
import type { PgBoss } from "pg-boss";

const logger = new Logger("QueueClient");

/**
 * The api's pg-boss client: `createQueueClient` plus the Nest logger on its
 * `error` event, so a dropped Postgres connection is logged and pg-boss
 * reconnects instead of the process exiting. 13.3.t.
 */
export function createApiQueueClient(databaseUrl: string): PgBoss {
  return createQueueClient({
    databaseUrl,
    onError: (error) => {
      logger.error(`pg-boss error; it will reconnect: ${error.message}`);
    },
  });
}
