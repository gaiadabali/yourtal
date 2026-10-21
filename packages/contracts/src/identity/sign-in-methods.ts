import * as z from "zod";

/**
 * Passkeys and authenticator-app codes on a YourTal account. The WebAuthn
 * request and response objects are the JSON forms browsers and
 * `@simplewebauthn/browser` produce; only their outline is checked here, the
 * signatures inside are checked by the server.
 */

const base64url = z
  .string()
  .min(1)
  .max(16_384)
  .regex(/^[A-Za-z0-9_-]+$/);

/** How the session was signed in to, as OIDC `amr` values. */
export const authMethodSchema = z.enum(["pwd", "hwk", "otp", "mfa"]);
export type AuthMethodValue = z.infer<typeof authMethodSchema>;

/** A browser's answer to `navigator.credentials.create()`, JSON-encoded. */
export const passkeyRegistrationResponseSchema = z.object({
  id: base64url,
  rawId: base64url,
  type: z.literal("public-key"),
  response: z.object({
    clientDataJSON: base64url,
    attestationObject: base64url,
    authenticatorData: base64url.optional(),
    transports: z.array(z.string().max(32)).max(8).optional(),
    publicKeyAlgorithm: z.number().int().optional(),
    publicKey: base64url.optional(),
  }),
  authenticatorAttachment: z.enum(["platform", "cross-platform"]).optional(),
  clientExtensionResults: z.record(z.string(), z.unknown()),
});

/** A browser's answer to `navigator.credentials.get()`, JSON-encoded. */
export const passkeyAuthenticationResponseSchema = z.object({
  id: base64url,
  rawId: base64url,
  type: z.literal("public-key"),
  response: z.object({
    clientDataJSON: base64url,
    authenticatorData: base64url,
    signature: base64url,
    userHandle: base64url.optional(),
  }),
  authenticatorAttachment: z.enum(["platform", "cross-platform"]).optional(),
  clientExtensionResults: z.record(z.string(), z.unknown()),
});

/** Options for `navigator.credentials.*`, passed to the browser as they are. */
export const webAuthnOptionsSchema = z.record(z.string(), z.unknown());

export const passkeyCeremonySchema = z.object({
  /** Names the single-use challenge; send it back with the response. */
  challengeId: z.string().min(1).max(64),
  options: webAuthnOptionsSchema,
});
export type PasskeyCeremony = z.infer<typeof passkeyCeremonySchema>;

export const passkeySignInRequestSchema = z.object({
  challengeId: z.string().min(1).max(64),
  response: passkeyAuthenticationResponseSchema,
});

export const passkeyRegisterRequestSchema = z.object({
  response: passkeyRegistrationResponseSchema,
  name: z.string().trim().min(1).max(64).optional(),
});

export const passkeySummarySchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1).max(64),
  createdAt: z.iso.datetime(),
  lastUsedAt: z.iso.datetime().nullable(),
  /** Synced to the person's other devices by their password manager. */
  synced: z.boolean(),
});
export type PasskeySummary = z.infer<typeof passkeySummarySchema>;

export const signInMethodsSchema = z.object({
  password: z.boolean(),
  passkeys: z.array(passkeySummarySchema),
  authenticatorApp: z.object({
    enabled: z.boolean(),
    /** False when this deployment has authenticator apps switched off: hide setting one up. */
    available: z.boolean(),
  }),
});
export type SignInMethods = z.infer<typeof signInMethodsSchema>;

const totpCodeSchema = z
  .string()
  .trim()
  .regex(/^\d{6}$/);

export const totpEnrolmentSchema = z.object({
  /** `otpauth://totp/...`, for the QR code. Contains the seed: show it, never log it. */
  otpauthUri: z.string().startsWith("otpauth://totp/"),
  /** The same seed in base32, for typing in by hand. */
  secret: z.string().min(16),
});
export type TotpEnrolment = z.infer<typeof totpEnrolmentSchema>;

export const totpCodeRequestSchema = z.object({ code: totpCodeSchema });

/**
 * Turning the authenticator app off needs a code from it, or a passkey: send
 * `code`, or `challengeId` with `response` (from `/passkeys/step-up/options`).
 * The server refuses a body with neither.
 */
export const totpDisableRequestSchema = z.object({
  code: totpCodeSchema.optional(),
  challengeId: z.string().min(1).max(64).optional(),
  response: passkeyAuthenticationResponseSchema.optional(),
});

/**
 * Proving an existing factor again (a code, or a passkey from
 * `/passkeys/step-up/options`) before changing sign-in methods from a session
 * signed in with a password alone. Same body as turning the app off.
 */
export const stepUpRequestSchema = totpDisableRequestSchema;

export const stepUpResultSchema = z.object({
  steppedUp: z.literal(true),
  /** How long changes stay unlocked on this session. */
  expiresInSeconds: z.number().int().positive(),
});

export const totpSignInRequestSchema = z.object({
  pendingToken: z.string().min(1).max(128),
  code: totpCodeSchema,
});

/** A session for the person who just signed in. */
export const signedInSchema = z.object({
  token: z.string().min(1),
  userId: z.string().min(1),
});

/** A password was right, and the account wants a code before a session. */
export const secondFactorRequiredSchema = z.object({
  secondFactor: z.literal("totp"),
  /** Answer with `POST /api/auth/totp/sign-in`. Single-use, short-lived. */
  pendingToken: z.string().min(1),
  expiresInSeconds: z.number().int().positive(),
});

/** `POST /api/auth/login` and `/password/reset/confirm`. */
export const passwordSignInResultSchema = z.union([signedInSchema, secondFactorRequiredSchema]);
export type PasswordSignInResult = z.infer<typeof passwordSignInResultSchema>;
