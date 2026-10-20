/** What the simulation needs to impersonate Stripe for one app. */
export interface PaySimConfig {
  appEnv: string;
  /** The one API key the simulation accepts. */
  secretKey: string;
  /** What webhook deliveries are signed with. */
  webhookSecret: string;
  /** Where events are POSTed. */
  webhookUrl: string;
  /** Browser-facing base of the pages: a session `url` is `${publicBaseUrl}/checkout/<id>`. */
  publicBaseUrl: string;
  /** Shown on the pages as the merchant's name. */
  accountName: string;
}

/** Echoed as `api_version` on events when a request names no `Stripe-Version`. */
export const DEFAULT_API_VERSION = "2024-06-20";
