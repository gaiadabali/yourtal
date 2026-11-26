import { Inject, Injectable, Logger } from "@nestjs/common";
import type { MailSession } from "@yourtal/contracts/spambank/common";
import type {
  AppPasswordCreated,
  AppPasswordList,
  EnableMailboxResult,
  MachineMailboxStatus,
  MailboxStatus,
} from "@yourtal/contracts/spambank/management";
import type { SpambankDriver } from "@yourtal/drivers/spambank";
import type { AppConfig } from "../../config/app-config";
import { APP_CONFIG } from "../../config/app-config.module";
import type { SpambankConfig } from "../../config/spambank-config";
import { SPAMBANK_MAILBOX_STORE } from "./management.tokens";
import type { MailboxStore } from "./persistence/mailbox.store";
import { SPAMBANK_CONFIG, SPAMBANK_DRIVER } from "./spambank.tokens";
import { createAppPassword, listAppPasswords, revokeAppPassword } from "./use-cases/app-passwords";
import { deleteMailbox } from "./use-cases/delete";
import type { Caller, ManagementDeps } from "./use-cases/deps";
import { enableMailbox } from "./use-cases/enable";
import { mintMailSession } from "./use-cases/session";
import { updateSettings } from "./use-cases/settings";
import { machineMailboxStatus, mailboxStatus } from "./use-cases/status";
import type { StatusSubject } from "./use-cases/status";

/**
 * The management API's one entry point for both doors: a YourTal session (`/api/spambank/me`) and an
 * app's server (`/api/oidc-clients/spambank`). Neither door decides anything about mail itself; both
 * name an already-authorized person and call the same use-cases (spambank/BUILD.md section 5.1, 5.2).
 */
@Injectable()
export class SpambankManagementService {
  private readonly deps: ManagementDeps;

  constructor(
    @Inject(SPAMBANK_MAILBOX_STORE) store: MailboxStore,
    @Inject(SPAMBANK_DRIVER) driver: SpambankDriver,
    @Inject(SPAMBANK_CONFIG) private readonly config: SpambankConfig,
    @Inject(APP_CONFIG) appConfig: AppConfig,
  ) {
    const logger = new Logger("SpambankManagement");
    this.deps = {
      store,
      driver,
      config,
      publicOrigin: appConfig.webOrigin.replace(/\/+$/, ""),
      log: {
        warn: (message) => {
          logger.warn(message);
        },
        error: (message) => {
          logger.error(message);
        },
      },
    };
  }

  /** YourTal's own switch (`SPAMBANK_ENABLED`); the machine routes do not read it. */
  get enabled(): boolean {
    return this.config.enabled;
  }

  status(subject: StatusSubject): Promise<MailboxStatus> {
    return mailboxStatus(this.deps, subject);
  }

  machineStatus(subject: StatusSubject): Promise<MachineMailboxStatus> {
    return machineMailboxStatus(this.deps, subject);
  }

  async enable(caller: Caller): Promise<EnableMailboxResult> {
    const outcome = await enableMailbox(this.deps, caller);
    return { state: "on", address: outcome.address, created: outcome.created };
  }

  session(caller: Caller): Promise<MailSession> {
    return mintMailSession(this.deps, caller);
  }

  listAppPasswords(userId: string): Promise<AppPasswordList> {
    return listAppPasswords(this.deps, userId);
  }

  createAppPassword(userId: string, name: string): Promise<AppPasswordCreated> {
    return createAppPassword(this.deps, userId, name);
  }

  revokeAppPassword(userId: string, appPasswordId: string): Promise<void> {
    return revokeAppPassword(this.deps, userId, appPasswordId);
  }

  async updateSettings(
    userId: string,
    patch: { statementsToSnapApp?: boolean | undefined; newMailAlerts?: boolean | undefined },
  ): Promise<void> {
    await updateSettings(this.deps, userId, patch);
  }

  deleteMailbox(userId: string): Promise<void> {
    return deleteMailbox(this.deps, userId);
  }
}
