import * as z from "zod";
import { financialYearSchema, transferProblemSchema } from "./transfer";

/**
 * Group 3.9 (docs/26 §1.1, §1.5): the API behind YourTal's `/connect/[uid]`
 * sign-in, consent and refusal screens. The web page's server calls it with
 * the browser's cookies: the provider's interaction cookies (`_interaction`,
 * `_interaction.sig`) in a `Cookie` header, and the YourTal session as the
 * `yt_session` cookie or `Authorization: Bearer`. Every answer about the app
 * comes from YourTal's client registry, never from the request.
 */

/** Why YourTal will not sign this person in to this app (docs/26 §1.5). */
export const signInRefusalSchema = z.enum([
  "account_on_hold",
  "region_not_supported",
  "teen_not_allowed",
  "teen_invite_required",
  // docs/30 §5: the app's send cannot go ahead; `sendProblem` says why.
  "send_refused",
]);
export type SignInRefusal = z.infer<typeof signInRefusalSchema>;

/**
 * Why a teen's invite does not open SnapApp (docs/26 §3.4), on `teen_invite_required`:
 * - `no_invite`: none was sent, and none stands;
 * - `not_approved`: the guardian has not approved the YourTal account yet;
 * - `wrong_inviter`: the invite was not made by the guardian who approved it;
 * - `invite_expired`: expired, already used, ended or unknown.
 */
export const teenInviteProblemSchema = z.enum([
  "no_invite",
  "not_approved",
  "wrong_inviter",
  "invite_expired",
]);
export type TeenInviteProblem = z.infer<typeof teenInviteProblemSchema>;

/**
 * What the screen shows:
 * - `login`: no YourTal session; sign in, then reload the details.
 * - `create`: no session and the app sent `prompt=create`; show sign-up.
 * - `verify_email`: signed in, email not verified yet.
 * - `sign_in_again`: signed in, but the app asked for a newer sign-in
 *   (`prompt=login` or `max_age`); sign out, sign in again, then reload.
 * - `consent`: first sign-in to this app, or it asks for more (the full consent screen).
 * - `continue`: already agreed; the one-tap "Continue to {app} as {name}".
 * - `send`: already agreed, and the app asked to send data to another app
 *   (docs/30 §5); see `send`. Send approves it and goes back to the app.
 * - `refused`: see `refusal`; the only way out is cancel ("Back to {app}").
 */
export const interactionScreenSchema = z.enum([
  "login",
  "create",
  "verify_email",
  "sign_in_again",
  "consent",
  "continue",
  "send",
  "refused",
]);
export type InteractionScreen = z.infer<typeof interactionScreenSchema>;

/** The app, as YourTal's registry describes it. */
export const interactionClientSchema = z.object({
  clientId: z.string().min(1),
  /** "SnapApp", "Free Tax Returns". */
  name: z.string().min(1),
  /** The company that runs the app, named on the consent screen. */
  operator: z.string().min(1),
  /** True when the app is run by a company outside YourTal's group of apps ("not by YourTal"). */
  externalOperator: z.boolean(),
  privacyUrl: z.url(),
  termsUrl: z.url(),
  /** "You'll go back to {returnHost}." */
  returnHost: z.string().min(1),
});
export type InteractionClient = z.infer<typeof interactionClientSchema>;

/** What the app will get, for the consent screen's list. Never the date of birth. */
export const interactionSharingSchema = z.object({
  claims: z.array(z.enum(["name", "email", "age_band", "region"])),
  ageBand: z.enum(["adult", "teen"]),
  region: z.enum(["AU", "ID"]),
});
export type InteractionSharing = z.infer<typeof interactionSharingSchema>;

/**
 * What the app asks to send, on `send` (docs/30 §5): "Send your {financialYear}
 * deductions to {to.name}?", and "{lineCount} deduction lines". `to` is the
 * destination app, named with its operator and privacy policy.
 */
export const interactionSendSchema = z.object({
  financialYear: financialYearSchema,
  lineCount: z.number().int().min(0),
  to: interactionClientSchema,
});
export type InteractionSend = z.infer<typeof interactionSendSchema>;

/** `GET /api/connect/{uid}`. */
export const interactionDetailsSchema = z.object({
  uid: z.string().min(1),
  screen: interactionScreenSchema,
  client: interactionClientSchema,
  /** The signed-in YourTal account, or null on `login` and `create`. */
  account: z.object({ name: z.string().min(1), email: z.string().min(1) }).nullable(),
  /** Set on `consent` and `continue`. */
  sharing: interactionSharingSchema.nullable(),
  /** Set on `refused` only. */
  refusal: signInRefusalSchema.nullable(),
  /** Set on `refused` with `teen_invite_required` only. Defaults to null, so an older API still parses. */
  inviteProblem: teenInviteProblemSchema.nullable().default(null),
  /**
   * Set for a teen on `consent` and `continue`: the invite that lets them in.
   * `parentName` is the inviting guardian's YourTal name ("Join SnapApp with {parent}'s invite").
   */
  teenInvite: z
    .object({ parentName: z.string().min(1) })
    .nullable()
    .default(null),
  /** Set on `send` only. Defaults to null, so an older API still parses. */
  send: interactionSendSchema.nullable().default(null),
  /**
   * Set on `refused` with `send_refused` only: `not_connected`, `wrong_account`,
   * `expired` or `not_allowed`, each with its own message ending "Nothing was sent."
   */
  sendProblem: transferProblemSchema.nullable().default(null),
  /** The app's `ui_locales`, in its order; the screen follows it, then the person's own language. */
  uiLocales: z.array(z.string()),
});
export type InteractionDetails = z.infer<typeof interactionDetailsSchema>;

/**
 * `POST /api/connect/{uid}/continue`. `screen` is the one the person tapped
 * Continue (or Send) on. A `continue` tap when consent is now needed answers
 * 409 `screen_changed`, so consent is only ever recorded from the consent
 * screen; likewise a send is only ever approved by a `send` tap on `send`.
 */
export const interactionContinueRequestSchema = z
  .object({ screen: z.enum(["consent", "continue", "send"]) })
  .strict();
export type InteractionContinueRequest = z.infer<typeof interactionContinueRequestSchema>;

/** `POST /api/connect/{uid}/cancel`. An empty object; the refusal, if any, is the server's to name. */
export const interactionCancelRequestSchema = z.object({}).strict();
export type InteractionCancelRequest = z.infer<typeof interactionCancelRequestSchema>;

/** Both POSTs answer with where the browser goes next: the provider, which then returns to the app. */
export const interactionRedirectSchema = z.object({ redirectTo: z.url() });
export type InteractionRedirect = z.infer<typeof interactionRedirectSchema>;

/**
 * The `error_description` an app gets with `error=access_denied`. A send
 * refused for any reason is `send_refused`, so the app never learns whether
 * the person uses the other app (docs/30 D4).
 */
export const accessDeniedReasonSchema = z.enum([...signInRefusalSchema.options, "user_cancelled"]);
export type AccessDeniedReason = z.infer<typeof accessDeniedReasonSchema>;
