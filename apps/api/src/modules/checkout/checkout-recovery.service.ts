import {
  Inject,
  Injectable,
  Logger,
  type OnModuleDestroy,
  type OnModuleInit,
} from "@nestjs/common";
import { sql } from "drizzle-orm";
import { APP_CONFIG } from "../../config/app-config.module";
import type { AppConfig } from "../../config/app-config";
import type { AppDb } from "../../shared/persistence/drizzle-client";
import { CHECKOUT_DB, SAGA_DEPS } from "./checkout.tokens";
import { recoverSagas } from "./use-cases/recover-sagas";
import type { SagaDeps } from "./use-cases/run-saga";

const EVERY_MS = 60_000;
// One api instance recovers at a time; the others skip the tick.
const LOCK_KEY = 4_7_0_1;

/**
 * 4.7.a's recovery job, in the process that owns the saga's clients. Tests
 * call `recoverSagas` directly, so it does not tick under NODE_ENV=test.
 */
@Injectable()
export class CheckoutRecoveryService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(CheckoutRecoveryService.name);
  private timer: NodeJS.Timeout | undefined;

  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(SAGA_DEPS) private readonly deps: SagaDeps,
    @Inject(CHECKOUT_DB) private readonly db: AppDb,
  ) {}

  onModuleInit(): void {
    if (this.config.nodeEnv === "test") return;
    this.timer = setInterval(() => void this.tick(), EVERY_MS);
    this.timer.unref();
  }

  onModuleDestroy(): void {
    clearInterval(this.timer);
  }

  private async tick(): Promise<void> {
    try {
      // A transaction-scoped lock: a pooled session lock could be released on another connection.
      await this.db.transaction(async (tx) => {
        const locked = await tx.execute<{ ok: boolean }>(
          sql`SELECT pg_try_advisory_xact_lock(${LOCK_KEY}) AS ok`,
        );
        if (locked.rows[0]?.ok !== true) return;
        const report = await recoverSagas(this.deps);
        if (report.finished + report.released + report.stillStuck > 0) {
          this.logger.log(`checkout recovery: ${JSON.stringify(report)}`);
        }
      });
    } catch (error) {
      this.logger.error("checkout recovery failed", error);
    }
  }
}
