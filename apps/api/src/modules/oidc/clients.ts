import type { AppConfig } from "../../config/app-config";

/**
 * Group 3.9: the apps that may sign people in with YourTal (docs/26 §1.9).
 * Static and reviewed in a pull request: there is no dynamic registration.
 * Secrets and public keys are never here; `client-keys.ts` reads them from
 * the configured directory. Everything the consent screen says about an app
 * comes from this file, never from a request.
 */
export type Region = "AU" | "ID";

interface ClientBase {
  readonly clientId: string;
  /** The app, on the screens: "SnapApp". */
  readonly name: string;
  /** The company named on the consent screen. F114: legal entity names are still to come. */
  readonly operator: string;
  /** Run by a company outside YourTal's group ("…, not by YourTal"). */
  readonly externalOperator: boolean;
  /** One pairwise `sub` per person per sector; an app's clients share it. */
  readonly sector: string;
  readonly allowedScopes: readonly string[];
  /** Where signed events go (docs/26 §2), for clients that receive them. */
  readonly eventsEndpoint?: string;
  /** Registered only in these environments. Empty: not registered yet. */
  readonly environments: readonly AppConfig["appEnv"][];
}

export interface SignInClient extends ClientBase {
  readonly kind: "web" | "native";
  readonly auth: "private_key_jwt" | "client_secret_basic" | "none";
  /** Exact, one per client (docs/26 §1.7). */
  readonly redirectUri: string;
  readonly teens: "refuse" | "invite_only";
  readonly regions: readonly Region[];
  readonly privacyUrl: string;
  readonly termsUrl: string;
  /** "You'll go back to {returnHost}." */
  readonly returnHost: string;
}

export interface MachineClient extends ClientBase {
  readonly kind: "machine";
  readonly auth: "private_key_jwt";
}

export type YourTalClient = SignInClient | MachineClient;

/** Every sign-in client may ask for these; `account` and `openid` are required (docs/26 §1.4). */
export const SIGN_IN_SCOPES = ["openid", "email", "profile", "account"] as const;
export const REQUIRED_SIGN_IN_SCOPES = ["openid", "account"] as const;

const SNAPAPP = {
  name: "SnapApp",
  operator: "SnapApp",
  externalOperator: false,
  sector: "snapapp-staging",
  privacyUrl: "https://snap-apps.gaiada.com/legal/privacy",
  termsUrl: "https://snap-apps.gaiada.com/legal/terms",
  returnHost: "snap-apps.gaiada.com",
  teens: "invite_only",
  regions: ["AU", "ID"],
  allowedScopes: SIGN_IN_SCOPES,
  environments: ["dev", "staging"],
} as const;

const FTR = {
  name: "Free Tax Returns",
  operator: "Benjamin Charles Group",
  externalOperator: true,
  teens: "refuse",
  // F110: Australia only.
  regions: ["AU"],
  allowedScopes: SIGN_IN_SCOPES,
} as const;

export const CLIENTS: readonly YourTalClient[] = [
  {
    ...SNAPAPP,
    clientId: "snapapp-staging-web",
    kind: "web",
    auth: "private_key_jwt",
    redirectUri: "https://snap-apps.gaiada.com/auth/yourtal/callback",
  },
  {
    ...SNAPAPP,
    clientId: "snapapp-staging-mobile",
    kind: "native",
    auth: "none",
    redirectUri: "au.com.snapapps.app:/oauth/yourtal",
  },
  {
    clientId: "snapapp-staging-server",
    name: SNAPAPP.name,
    operator: SNAPAPP.operator,
    externalOperator: false,
    sector: SNAPAPP.sector,
    kind: "machine",
    auth: "private_key_jwt",
    allowedScopes: ["teen_invites"],
    eventsEndpoint: "https://snap-apps-api.gaiada.com/v1/yourtal/events",
    environments: ["dev", "staging"],
  },
  {
    ...FTR,
    clientId: "ftr-staging-web",
    sector: "ftr-staging",
    kind: "web",
    auth: "client_secret_basic",
    redirectUri: "https://freetaxreturns.gaiada.online/api/auth/oauth2/callback/yourtal",
    privacyUrl: "https://freetaxreturns.gaiada.online/privacy",
    termsUrl: "https://freetaxreturns.gaiada.online/terms",
    returnHost: "freetaxreturns.gaiada.online",
    eventsEndpoint: "https://freetaxreturns.gaiada.online/api/yourtal/events",
    environments: ["dev", "staging"],
  },
  {
    // Registered only once real people may sign in (docs/26 §6 Q1, F108).
    ...FTR,
    clientId: "ftr-web",
    sector: "ftr",
    kind: "web",
    auth: "client_secret_basic",
    redirectUri: "https://freetaxreturns.com.au/api/auth/oauth2/callback/yourtal",
    privacyUrl: "https://freetaxreturns.com.au/privacy",
    termsUrl: "https://freetaxreturns.com.au/terms",
    returnHost: "freetaxreturns.com.au",
    eventsEndpoint: "https://freetaxreturns.com.au/api/yourtal/events",
    environments: [],
  },
];

export function clientsFor(appEnv: AppConfig["appEnv"]): readonly YourTalClient[] {
  return CLIENTS.filter((client) => client.environments.includes(appEnv));
}

export function isSignInClient(client: YourTalClient): client is SignInClient {
  return client.kind !== "machine";
}

export function clientById(
  clients: readonly YourTalClient[],
  clientId: string,
): YourTalClient | undefined {
  return clients.find((client) => client.clientId === clientId);
}
