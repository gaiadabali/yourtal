import * as z from "zod";
import {
  passkeyCeremonySchema,
  passkeyRegisterRequestSchema,
  passkeySignInRequestSchema,
  passkeySummarySchema,
  signInMethodsSchema,
  signedInSchema,
  totpCodeRequestSchema,
  totpDisableRequestSchema,
  totpEnrolmentSchema,
  totpSignInRequestSchema,
  webAuthnOptionsSchema,
} from "../identity/sign-in-methods";
import {
  FORBIDDEN,
  SERVICE_UNAVAILABLE,
  VALIDATION_400,
  inlineSchema,
  type RouteDefinition,
  type RouteErrorResponse,
} from "./route-registry-shared";

/**
 * Area A: passkeys and authenticator-app codes (`apps/api/src/modules/auth/
 * factors`). Every route acts on the caller's own account, taken from the
 * session, or (signing in) on the account the passkey or pending token
 * proves; none takes a user id. The password routes these sit beside
 * (`/api/auth/login` and the rest) are not in this registry yet.
 */

const TAGS = ["auth"] as const;

const FACTOR_INVALID: RouteErrorResponse = {
  status: 401,
  description:
    "factor_invalid: a wrong or already-used code, an unknown passkey, a response that does " +
    "not verify, or a challenge that expired or was already answered. One code for all of them.",
  documented: true,
};

const SESSION_INVALID: RouteErrorResponse = {
  status: 401,
  description: "session_invalid: no live session.",
  documented: true,
};

const REAUTHENTICATION_REQUIRED: RouteErrorResponse = {
  status: 403,
  description:
    "reauthentication_required: adding a sign-in method needs a sign-in from the last 15 " +
    "minutes. Sign in again, then retry.",
  documented: true,
};

const THROTTLED: RouteErrorResponse = {
  status: 429,
  description:
    "Too many attempts: the route's rate limit, or (codes) five wrong codes for this account " +
    "in 15 minutes. The body carries retryAfterSeconds.",
  documented: false,
};

const TOTP_CONFLICT = (code: string, description: string): RouteErrorResponse => ({
  status: 409,
  description: `${code}: ${description}`,
  documented: true,
});

const PASSKEY_NOT_FOUND: RouteErrorResponse = {
  status: 404,
  description: "passkey_not_found: no such passkey on this account.",
  documented: true,
};

const CREDENTIAL_ID_PARAM = {
  name: "credentialId",
  description: "The passkey's WebAuthn credential id (base64url), as listed.",
  schema: { type: "string" },
};

export const SIGN_IN_METHOD_ROUTE_DEFINITIONS: readonly RouteDefinition[] = [
  {
    method: "post",
    path: "/api/auth/passkeys/sign-in/options",
    summary: "Start signing in with a passkey — no email needed",
    tags: TAGS,
    pathParams: [],
    successStatus: 201,
    successDescription:
      "A single-use challenge (5 minutes) and the options for navigator.credentials.get().",
    successSchema: inlineSchema(passkeyCeremonySchema),
    errors: [FORBIDDEN, THROTTLED, SERVICE_UNAVAILABLE],
  },
  {
    method: "post",
    path: "/api/auth/passkeys/sign-in",
    summary: "Finish signing in with a passkey; issues a session (amr hwk)",
    tags: TAGS,
    pathParams: [],
    requestBody: {
      description: "The challenge id from the options call and the browser's response.",
      schema: inlineSchema(passkeySignInRequestSchema),
    },
    successStatus: 201,
    successDescription: "Signed in.",
    successSchema: inlineSchema(signedInSchema),
    errors: [VALIDATION_400, FACTOR_INVALID, FORBIDDEN, THROTTLED, SERVICE_UNAVAILABLE],
  },
  {
    method: "get",
    path: "/api/auth/sign-in-methods",
    summary: "How the caller's account can sign in: password, passkeys, authenticator app",
    tags: TAGS,
    pathParams: [],
    successStatus: 200,
    successDescription: "Never a public key, a counter or a seed.",
    successSchema: inlineSchema(signInMethodsSchema),
    errors: [SESSION_INVALID, FORBIDDEN, SERVICE_UNAVAILABLE],
  },
  {
    method: "post",
    path: "/api/auth/passkeys/register/options",
    summary: "Start adding a passkey to the caller's account",
    tags: TAGS,
    pathParams: [],
    successStatus: 201,
    successDescription: "Options for navigator.credentials.create(); the challenge is single-use.",
    successSchema: inlineSchema(z.object({ options: webAuthnOptionsSchema })),
    errors: [SESSION_INVALID, REAUTHENTICATION_REQUIRED, FORBIDDEN, THROTTLED, SERVICE_UNAVAILABLE],
  },
  {
    method: "post",
    path: "/api/auth/passkeys/register",
    summary: "Finish adding a passkey",
    tags: TAGS,
    pathParams: [],
    requestBody: {
      description: "The browser's registration response and an optional name (default Passkey).",
      schema: inlineSchema(passkeyRegisterRequestSchema),
    },
    successStatus: 201,
    successDescription: "The new passkey.",
    successSchema: inlineSchema(passkeySummarySchema),
    errors: [
      VALIDATION_400,
      FACTOR_INVALID,
      SESSION_INVALID,
      REAUTHENTICATION_REQUIRED,
      FORBIDDEN,
      THROTTLED,
      SERVICE_UNAVAILABLE,
    ],
  },
  {
    method: "post",
    path: "/api/auth/passkeys/step-up/options",
    summary: "Prove one of the caller's own passkeys again, before a sensitive change",
    tags: TAGS,
    pathParams: [],
    successStatus: 201,
    successDescription: "A single-use challenge limited to the caller's own passkeys.",
    successSchema: inlineSchema(passkeyCeremonySchema),
    errors: [SESSION_INVALID, PASSKEY_NOT_FOUND, FORBIDDEN, THROTTLED, SERVICE_UNAVAILABLE],
  },
  {
    method: "delete",
    path: "/api/auth/passkeys/{credentialId}",
    summary: "Remove one of the caller's passkeys",
    tags: TAGS,
    pathParams: [CREDENTIAL_ID_PARAM],
    successStatus: 200,
    successDescription: "Removed.",
    successSchema: inlineSchema(z.object({ removed: z.literal(true) })),
    errors: [
      SESSION_INVALID,
      PASSKEY_NOT_FOUND,
      TOTP_CONFLICT(
        "last_sign_in_method",
        "nothing else could sign this account in (no password, no other passkey).",
      ),
      FORBIDDEN,
      SERVICE_UNAVAILABLE,
    ],
  },
  {
    method: "post",
    path: "/api/auth/totp/enrol",
    summary: "Start setting up an authenticator app",
    tags: TAGS,
    pathParams: [],
    successStatus: 201,
    successDescription:
      "The otpauth URI for a QR code and the same seed for typing in. Off until confirmed.",
    successSchema: inlineSchema(totpEnrolmentSchema),
    errors: [
      SESSION_INVALID,
      REAUTHENTICATION_REQUIRED,
      TOTP_CONFLICT("totp_already_enabled", "an authenticator app is already on."),
      FORBIDDEN,
      THROTTLED,
      SERVICE_UNAVAILABLE,
    ],
  },
  {
    method: "post",
    path: "/api/auth/totp/confirm",
    summary: "Switch the authenticator app on with a first code from it",
    tags: TAGS,
    pathParams: [],
    requestBody: {
      description: "A 6-digit code.",
      schema: inlineSchema(totpCodeRequestSchema),
    },
    successStatus: 201,
    successDescription: "On. Password sign-ins now ask for a code.",
    successSchema: inlineSchema(z.object({ enabled: z.literal(true) })),
    errors: [
      VALIDATION_400,
      FACTOR_INVALID,
      SESSION_INVALID,
      TOTP_CONFLICT("totp_already_enabled", "the app is already on."),
      FORBIDDEN,
      THROTTLED,
      SERVICE_UNAVAILABLE,
    ],
  },
  {
    method: "post",
    path: "/api/auth/totp/disable",
    summary: "Turn the authenticator app off, proving a code or a passkey",
    tags: TAGS,
    pathParams: [],
    requestBody: {
      description: "code, or challengeId with response from /passkeys/step-up/options.",
      schema: inlineSchema(totpDisableRequestSchema),
    },
    successStatus: 201,
    successDescription: "Off.",
    successSchema: inlineSchema(z.object({ enabled: z.literal(false) })),
    errors: [
      VALIDATION_400,
      FACTOR_INVALID,
      SESSION_INVALID,
      TOTP_CONFLICT("totp_not_enabled", "no authenticator app is on."),
      FORBIDDEN,
      THROTTLED,
      SERVICE_UNAVAILABLE,
    ],
  },
  {
    method: "post",
    path: "/api/auth/totp/sign-in",
    summary: "The code step after a password; issues a session (amr pwd, otp, mfa)",
    tags: TAGS,
    pathParams: [],
    requestBody: {
      description: "The pendingToken from /api/auth/login and a 6-digit code.",
      schema: inlineSchema(totpSignInRequestSchema),
    },
    successStatus: 201,
    successDescription: "Signed in.",
    successSchema: inlineSchema(signedInSchema),
    errors: [VALIDATION_400, FACTOR_INVALID, FORBIDDEN, THROTTLED, SERVICE_UNAVAILABLE],
  },
];
