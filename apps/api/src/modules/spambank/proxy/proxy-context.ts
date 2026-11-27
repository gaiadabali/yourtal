import type { SpambankDriver } from "@yourtal/drivers/spambank";
import type { SpambankConfig } from "../../../config/spambank-config";
import type { OneClickPoster } from "../mail/ssrf-guard";
import type { EventStreams } from "./event-streams";
import type { MailAuthenticator } from "./mail-auth";
import type { SpambankMailStore } from "./mail-store";
import type { MailRateLimiter } from "./rate-limits";
import type { UpstreamSessions } from "./upstream-session";

/** Everything the mail API's routes share (spambank/BUILD.md §5.3). */
export interface ProxyContext {
  readonly driver: SpambankDriver;
  readonly config: SpambankConfig;
  /** The public origin the API is reached at, e.g. `https://yourtal.gaiada.com`. */
  readonly publicOrigin: string;
  readonly store: SpambankMailStore;
  readonly auth: MailAuthenticator;
  readonly sessions: UpstreamSessions;
  readonly limiter: MailRateLimiter;
  readonly streams: EventStreams;
  /** The RFC 8058 one-click POST, behind the SSRF guard. */
  readonly oneClick: OneClickPoster;
  /** For tests; 25 minutes otherwise. */
  readonly streamLifetimeMs?: number;
}
