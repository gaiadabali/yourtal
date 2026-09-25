import type { BoundaryName } from "./boundary";
import { type DriverMode, type Environment, assertDriversConfigured } from "./driver-mode";
import type { FaultPlan } from "./faults";
import { type PaymentsDriver, createPaymentsDriver } from "./boundaries/payments";
import { type DisbursementDriver, createDisbursementDriver } from "./boundaries/disbursement";
import { type BotCheckDriver, createBotCheckDriver } from "./boundaries/bot-check";
import { type OtpDriver, createOtpDriver } from "./boundaries/otp";
import { type MessagingDriver, createMessagingDriver } from "./boundaries/messaging";
import { type DigitalGoodsDriver, createDigitalGoodsDriver } from "./boundaries/digital-goods";
import { type ReceiptIngestDriver, createReceiptIngestDriver } from "./boundaries/receipt-ingest";
import { type ModerationDriver, createModerationDriver } from "./boundaries/moderation";
import {
  type DeviceReputationDriver,
  createDeviceReputationDriver,
} from "./boundaries/device-reputation";
import { type EmailDriver, createEmailDriver } from "./boundaries/email";
import { type PushDriver, createPushDriver } from "./boundaries/push";
import { type WebhookDriver, createWebhookDriver } from "./boundaries/webhook";

/**
 * Every external boundary, constructed together. YT-0535.
 *
 * ## Why one call rather than eight
 *
 * Because the boot rule has to apply to all of them at once.
 * `assertDriversConfigured` runs first and throws with **every**
 * misconfigured boundary listed, so a deployment learns about four missing
 * variables in one go rather than one restart at a time.
 *
 * It also makes the set closed. `Drivers` names all eight, so adding a
 * boundary to `BOUNDARY_NAMES` without wiring it here is a type error rather
 * than an omission nobody notices — and `registry.test.ts` checks the two
 * lists agree, because a boundary that exists in the registry but not the
 * catalogue is invisible to the parity suite (YT-0539) that is supposed to
 * be watching it.
 *
 * ## Faults are passed in, never configured by environment
 *
 * Deliberately not `PAYMENTS_FAULT=timeout`. A fault that can be switched on
 * by environment is a fault that can reach a running deployment, and the
 * whole point of the catalogue is to exercise error paths in tests. Tests
 * pass a plan directly; nothing else can.
 */
export interface Drivers {
  readonly payments: PaymentsDriver;
  readonly disbursement: DisbursementDriver;
  readonly botCheck: BotCheckDriver;
  readonly otp: OtpDriver;
  readonly messaging: MessagingDriver;
  readonly digitalGoods: DigitalGoodsDriver;
  readonly receiptIngest: ReceiptIngestDriver;
  readonly moderation: ModerationDriver;
  readonly deviceReputation: DeviceReputationDriver;
  readonly email: EmailDriver;
  readonly push: PushDriver;
  readonly webhook: WebhookDriver;
}

export type FaultPlans = Partial<Record<BoundaryName, FaultPlan>>;

export function createDrivers(env: Environment, faults: FaultPlans = {}): Drivers {
  // Throws before anything is constructed. A driver set that is half-built
  // when the ninth boundary turns out to be misconfigured is worse than one
  // that never existed.
  const modes: Record<BoundaryName, DriverMode> = assertDriversConfigured(env);

  return {
    payments: createPaymentsDriver(modes.payments, env, faults.payments),
    disbursement: createDisbursementDriver(modes.disbursement, env, faults.disbursement),
    botCheck: createBotCheckDriver(modes.bot_check, env, faults.bot_check),
    otp: createOtpDriver(modes.otp, env, faults.otp),
    messaging: createMessagingDriver(modes.messaging, env, faults.messaging),
    digitalGoods: createDigitalGoodsDriver(modes.digital_goods, env, faults.digital_goods),
    receiptIngest: createReceiptIngestDriver(modes.receipt_ingest, env, faults.receipt_ingest),
    moderation: createModerationDriver(modes.moderation, env, faults.moderation),
    deviceReputation: createDeviceReputationDriver(
      modes.device_reputation,
      env,
      faults.device_reputation,
    ),
    // Each defaults to its own in-memory SimOutboxStore (sim-outbox.ts) —
    // fine for a driver set built with no other arguments, same as every
    // other boundary here holding its own private state. A caller that
    // wants every simulated send visible in the real platform.sim_outbox
    // table (so /api/dev/inbox and another process can see it) constructs
    // that boundary directly with a real store instead of through this
    // factory — see postgres-sim-outbox-store.ts in apps/api.
    email: createEmailDriver(modes.email, env, faults.email),
    push: createPushDriver(modes.push, env, faults.push),
    webhook: createWebhookDriver(modes.webhook, env, faults.webhook),
  };
}

/** The boundary each `Drivers` key belongs to. Used by the completeness test. */
export const DRIVER_KEY_TO_BOUNDARY: Record<keyof Drivers, BoundaryName> = {
  payments: "payments",
  disbursement: "disbursement",
  botCheck: "bot_check",
  otp: "otp",
  messaging: "messaging",
  digitalGoods: "digital_goods",
  receiptIngest: "receipt_ingest",
  moderation: "moderation",
  deviceReputation: "device_reputation",
  email: "email",
  push: "push",
  webhook: "webhook",
};
