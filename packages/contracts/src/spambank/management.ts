import * as z from "zod";
import { MAILBOX_STATES } from "./common";

/**
 * Spambank's management API (spambank/BUILD.md §5.1, §5.2): what a person's own session and each app's
 * server (with its client-credentials token) send and get to switch a mailbox on, open it and manage
 * its app passwords. The mail itself goes through the proxy (T5), not through these.
 */

/** §4.10: a name for the phone mail app it is made for, and at most five at a time. */
export const APP_PASSWORD_NAME_MAX = 40;
export const APP_PASSWORDS_MAX = 5;

/** The app's own pairwise `sub`: the only way an app names a person (§5.2). */
const subSchema = z.string().min(1).max(255);

const isoDateTime = z.iso.datetime({ offset: true });

export const mailboxQuotaSchema = z.object({
  limitBytes: z.number().int().nonnegative(),
  usedBytes: z.number().int().nonnegative(),
});
export type MailboxQuota = z.infer<typeof mailboxQuotaSchema>;

/**
 * `GET /api/spambank/me`, and the machine `/status`. `available: false` means the feature is switched
 * off and nothing else is set. `quota` is left out when the mail server could not be asked.
 */
export const mailboxStatusSchema = z.object({
  available: z.boolean(),
  state: z.enum(MAILBOX_STATES).optional(),
  address: z.email().optional(),
  quota: mailboxQuotaSchema.optional(),
  createdAt: isoDateTime.optional(),
});
export type MailboxStatus = z.infer<typeof mailboxStatusSchema>;

export const mailboxSettingsSchema = z.object({
  statementsToSnapApp: z.boolean(),
  newMailAlerts: z.boolean(),
});
export type MailboxSettings = z.infer<typeof mailboxSettingsSchema>;

/** The machine `/status`: the same, plus the settings an app may read. */
export const machineMailboxStatusSchema = mailboxStatusSchema.extend({
  settings: mailboxSettingsSchema,
});
export type MachineMailboxStatus = z.infer<typeof machineMailboxStatusSchema>;

/** `201` for a new mailbox, `200` for the existing one. */
export const enableMailboxResultSchema = z.object({
  state: z.literal("on"),
  address: z.email(),
  created: z.boolean(),
});
export type EnableMailboxResult = z.infer<typeof enableMailboxResultSchema>;

export const appPasswordSummarySchema = z.object({
  id: z.string().min(1),
  name: z.string(),
  createdAt: isoDateTime.nullable(),
});
export type AppPasswordSummary = z.infer<typeof appPasswordSummarySchema>;

export const appPasswordListSchema = z.object({ items: z.array(appPasswordSummarySchema) });
export type AppPasswordList = z.infer<typeof appPasswordListSchema>;

export const createAppPasswordRequestSchema = z
  .object({ name: z.string().trim().min(1).max(APP_PASSWORD_NAME_MAX) })
  .strict();
export type CreateAppPasswordRequest = z.infer<typeof createAppPasswordRequestSchema>;

const connectionSchema = z.object({
  host: z.string().min(1),
  port: z.number().int().positive(),
  security: z.literal("ssl"),
});

/** `201`. The `secret` is shown once; nothing returns it again. */
export const appPasswordCreatedSchema = appPasswordSummarySchema.extend({
  secret: z.string().min(1),
  /** The full address: the login for the phone's mail app. */
  username: z.email(),
  imap: connectionSchema,
  smtp: connectionSchema,
});
export type AppPasswordCreated = z.infer<typeof appPasswordCreatedSchema>;

/** Every machine route names the person this way. */
export const machineSubRequestSchema = z.object({ sub: subSchema }).strict();
export type MachineSubRequest = z.infer<typeof machineSubRequestSchema>;

/** `/settings`: SnapApp's sector only. At least one field is needed. */
export const machineSettingsRequestSchema = z
  .object({
    sub: subSchema,
    statementsToSnapApp: z.boolean().optional(),
    newMailAlerts: z.boolean().optional(),
  })
  .strict();
export type MachineSettingsRequest = z.infer<typeof machineSettingsRequestSchema>;

export const machineCreateAppPasswordRequestSchema = z
  .object({ sub: subSchema, name: z.string().trim().min(1).max(APP_PASSWORD_NAME_MAX) })
  .strict();
export type MachineCreateAppPasswordRequest = z.infer<typeof machineCreateAppPasswordRequestSchema>;

/** The `:id` of `DELETE /api/spambank/me/app-passwords/:id`, and the machine revoke. */
export const appPasswordIdSchema = z.string().regex(/^[A-Za-z0-9_-]{1,64}$/);
export const machineRevokeAppPasswordRequestSchema = z
  .object({ sub: subSchema, id: appPasswordIdSchema })
  .strict();
export type MachineRevokeAppPasswordRequest = z.infer<typeof machineRevokeAppPasswordRequestSchema>;
