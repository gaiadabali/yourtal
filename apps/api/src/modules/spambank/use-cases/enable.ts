import type { SpambankFailure } from "@yourtal/drivers/spambank";
import { generateLocalPart } from "../naming/generate";
import type { MailboxRecord } from "../persistence/mailbox.store";
import { addressOf } from "./deps";
import type { Caller, ManagementDeps } from "./deps";
import { mailboxErasing, notAllowed, spambankUnavailable } from "./errors";
import { ProvisionError, provisionMailbox } from "./provision";

/**
 * Switching a mailbox on (spambank/BUILD.md section 4.1, 4.2, F1). One name per person, made now and
 * final: a deleted name is never given out again. Safe to repeat and to run twice at once (one
 * person's calls take a lock): the second finds the first's mailbox and returns it.
 *
 * The row is written first (`provisioning`, with its name), then the mail account is created, then
 * its folders are set up, then the row becomes `active`. A failure leaves the row `provisioning` and
 * answers 503; the next call resumes from where it stopped.
 */

export interface EnableOutcome {
  readonly address: string;
  /** True when this call made the mailbox usable (the 201); false when it already was (the 200). */
  readonly created: boolean;
}

/** Ten plain names, then ten with a two-digit suffix (BUILD.md 4.1). */
const PLAIN_ATTEMPTS = 10;
const TOTAL_ATTEMPTS = 20;

function failed(deps: ManagementDeps, step: string, failure: SpambankFailure): never {
  // `upstream_auth` means our derived credential was refused: an operator problem, not a retry one.
  const message = `spambank enable: ${step} failed (${failure.code}): ${failure.detail}`;
  if (failure.code === "upstream_auth") deps.log.error(message);
  else deps.log.warn(message);
  throw spambankUnavailable();
}

/** Gives the row its Stalwart account, drawing another name when Stalwart already has this one. */
async function withAccount(
  deps: ManagementDeps,
  caller: Caller,
  start: MailboxRecord | null,
): Promise<MailboxRecord> {
  const { store, driver, config } = deps;
  let mailbox = start;
  for (let attempt = 0; attempt < TOTAL_ATTEMPTS; attempt += 1) {
    if (mailbox === null) {
      const localPart = generateLocalPart({
        suffix: attempt >= PLAIN_ATTEMPTS,
        ...(deps.random === undefined ? {} : { random: deps.random }),
      });
      const inserted = await store.insertProvisioning({
        userId: caller.person.userId,
        region: caller.person.region,
        localPart,
        domain: config.mailDomain,
        enabledVia: caller.app,
      });
      if (inserted.kind === "name_taken") continue;
      mailbox = inserted.mailbox;
    }
    if (mailbox.status !== "provisioning" || mailbox.stalwartAccountId !== null) return mailbox;

    const created = await driver.createAccount({
      localPart: mailbox.localPart,
      domain: mailbox.domain,
      quotaBytes: config.quotaBytes,
    });
    if (created.isOk()) {
      await store.setStalwartAccount(mailbox.id, created.value.accountId);
      return { ...mailbox, stalwartAccountId: created.value.accountId };
    }
    if (created.error.code !== "already_exists")
      failed(deps, "creating the account", created.error);
    // Stalwart has an account of this name that we know nothing about (a crash between its creation
    // and our write). Retire the name so it is not drawn again, and try another.
    deps.log.warn(
      `spambank enable: Stalwart already has an account named ${mailbox.localPart}; the name is retired`,
    );
    await store.discardProvisioning(mailbox.id, mailbox.localPart, true);
    mailbox = null;
  }
  throw spambankUnavailable("no free name could be found; try again");
}

/** Folders, the Sieve rule and the identity as the account, then `active`. */
async function finish(deps: ManagementDeps, mailbox: MailboxRecord): Promise<MailboxRecord> {
  const { driver, store } = deps;
  let junkMailboxId: string | null = null;
  let emailState: string | null = null;
  // The simulator has no mail server to set up; its mailbox is active so the rest of the app can be
  // driven in development and in tests.
  if (driver.mode === "live") {
    try {
      const done = await provisionMailbox(
        driver.account(mailbox.localPart, mailbox.domain),
        addressOf(mailbox),
      );
      junkMailboxId = done.junkMailboxId;
      emailState = done.emailState;
      if (done.degraded.length > 0) {
        deps.log.warn(
          `spambank enable: ${mailbox.localPart} is active but ${done.degraded.join("; ")}`,
        );
      }
    } catch (error) {
      if (error instanceof ProvisionError) {
        const code = error.failure?.code ?? "unexpected";
        const message = `spambank enable: setting up ${mailbox.localPart} failed (${code}): ${error.message}`;
        if (code === "upstream_auth") deps.log.error(message);
        else deps.log.warn(message);
        throw spambankUnavailable();
      }
      throw error;
    }
  }
  const active = await store.activate(mailbox.id, { junkMailboxId, emailState });
  // Null: the mailbox was erased while it was being set up.
  if (active === null) throw mailboxErasing();
  return active;
}

export async function enableMailbox(deps: ManagementDeps, caller: Caller): Promise<EnableOutcome> {
  const { store } = deps;
  return store.withUserLock(caller.person.userId, async () => {
    const existing = await store.find(caller.person.userId);
    if (existing?.status === "erasing") throw mailboxErasing();
    if (existing?.status === "suspended") throw notAllowed("the mailbox is suspended");
    if (existing?.status === "active") {
      return { address: addressOf(existing), created: false };
    }
    const withAcct = await withAccount(deps, caller, existing);
    // A race that made the row between our check and our insert can leave it already active.
    if (withAcct.status === "active") return { address: addressOf(withAcct), created: false };
    const active = await finish(deps, withAcct);
    return { address: addressOf(active), created: true };
  });
}
