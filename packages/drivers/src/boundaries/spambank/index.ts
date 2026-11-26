import type { DriverMode, Environment } from "../../driver-mode";
import type { FaultPlan } from "../../faults";
import { createLiveSpambank, liveOptionsFromEnv } from "./live";
import { createSimulatedSpambank } from "./simulated";
import type { SpambankDriver } from "./types";

export type {
  AppPasswordSummary,
  CreateAccountInput,
  CreatedAccount,
  CreatedAppPassword,
  JmapMethodCall,
  JmapRequest,
  JmapResponse,
  SpambankAccountClient,
  SpambankDomain,
  SpambankDriver,
  SpambankFailure,
  SpambankFailureCode,
  SpambankResult,
  UpstreamInit,
} from "./types";
export { addressFor, derivePassword, loginFor } from "./credentials";
export { createLiveSpambank, resolveUpstream } from "./live";
export type { LiveSpambankOptions } from "./live";
export { createSimulatedSpambank } from "./simulated";

/** The domains the simulator claims to serve; the same defaults the API config uses. */
export const DEFAULT_MAIL_DOMAIN = "yourtal.gaiada.com";
export const DEFAULT_REPLY_DOMAIN = "spambank.yourtal.gaiada.com";

function nonBlank(value: string | undefined, fallback: string): string {
  const trimmed = value?.trim();
  return trimmed === undefined || trimmed === "" ? fallback : trimmed;
}

/**
 * `live` talks to Stalwart; its variables were already checked by `resolveDriverMode`, and an
 * unusable value (not a URL, a short key) throws here, at construction, never on the first call.
 * Constructing it makes no request, so a Stalwart that is down never stops the API from booting.
 */
export function createSpambankDriver(
  mode: DriverMode,
  env: Environment,
  faultPlan?: FaultPlan,
): SpambankDriver {
  if (mode === "live") return createLiveSpambank(liveOptionsFromEnv(env));
  return createSimulatedSpambank({
    domains: [
      nonBlank(env.SPAMBANK_MAIL_DOMAIN, DEFAULT_MAIL_DOMAIN),
      nonBlank(env.SPAMBANK_REPLY_DOMAIN, DEFAULT_REPLY_DOMAIN),
    ],
    ...(faultPlan === undefined ? {} : { faultPlan }),
  });
}
