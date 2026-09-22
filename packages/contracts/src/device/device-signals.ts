/**
 * Device signals at registration. YT-0051.
 *
 * ## The one property this file exists to protect
 *
 * **Everything the client reports is attacker-controlled.** A fingerprint,
 * a `webdriver` flag, a plugin count — each is a *claim made by the thing
 * being assessed*. Anyone who can open devtools can send whatever values
 * they like, and someone automating signups will. So the types here split
 * signals by **who observed them**, and that split is not cosmetic:
 *
 * - `ClientReportedSignals` — collected in the page or the app. Useful,
 *   never trusted.
 * - `ServerObservedSignals` — measured by our own infrastructure from the
 *   connection itself. The client cannot forge these by editing a payload,
 *   because it never supplies them.
 *
 * `DeviceSignalReport` can only be built by naming both, so a caller cannot
 * quietly end up treating a browser's self-description as evidence. The
 * failure this prevents is specific and common: a risk score computed from
 * a blob of mixed signals, where the attacker-controlled half and the
 * observed half are indistinguishable by the time anything reads it.
 *
 * ## Signals, not a verdict
 *
 * Nothing here returns `isBot: boolean`. It returns what was observed and
 * lets a policy decide, which is the same shape `question-response-signals`
 * settled on for latency and entropy, and for the same reason: `docs/18`
 * §11 wants suspension and review, not a silent rejection. A collector that
 * returns a verdict has made a policy decision in the wrong layer, and the
 * threshold becomes impossible to change without changing the collector.
 *
 * A high `automationScore` is a reason to look, never a reason to refuse on
 * its own. Headless detection has false positives — accessibility tooling,
 * privacy browsers, and every locked-down corporate build look automated
 * on at least one axis.
 *
 * ## One interface, two platforms
 *
 * `DeviceSignalCollector` is the interface the ticket asks for. The web
 * implementation ships first; a Capacitor/native one implements the same
 * interface later. `platform` is on the collector rather than inferred,
 * because a native build reporting web-shaped signals is a bug that is
 * otherwise invisible — the values all look plausible.
 *
 * This file is deliberately platform-agnostic: no `navigator`, no `window`,
 * nothing that assumes a DOM. `packages/contracts` is imported by the API
 * as well as the browser, and a DOM reference here would break the server
 * build for a type that the server very much needs.
 */

/** Which implementation produced a report. */
export type DeviceSignalPlatform = "web" | "native";

/**
 * A stable-ish identifier for the device, computed by the client.
 *
 * **Not an identity and not a secret.** Two different people on identical
 * stock devices can collide, and the same person clears it by switching
 * browser or profile. Treat a repeat as weak corroboration and a change as
 * almost no evidence at all — the common mistake is the reverse, treating a
 * new fingerprint as suspicious, which penalises exactly the privacy-
 * conscious and the newly-onboarded.
 */
export interface DeviceFingerprint {
  /** Opaque, client-computed. Never parse it or derive meaning from parts. */
  readonly hash: string;
  /**
   * How many independent inputs fed the hash. A fingerprint built from two
   * inputs collides constantly; one built from twenty is comparatively
   * distinctive. Without this, a caller cannot tell a weak fingerprint from
   * a strong one and will treat both as equally meaningful.
   */
  readonly inputCount: number;
}

/**
 * Indicators that the session is driven by software rather than a person.
 *
 * Each is an observation with a known false-positive story, so they are
 * reported individually rather than pre-summed. A caller that wants one
 * number can add them up; a caller that wants to know *which* signals fired
 * cannot recover that from a total.
 */
export interface AutomationIndicators {
  /** `navigator.webdriver` or equivalent. Trivially spoofed downward — absence proves nothing. */
  readonly webdriverFlag: boolean;
  /** Headless browser build detected by rendering or UA-stack inconsistency. */
  readonly headlessHints: number;
  /** Values that disagree with each other, e.g. a mobile UA with a desktop viewport. */
  readonly inconsistencyHints: number;
}

/**
 * What the client said about itself. **Attacker-controlled. Never trusted.**
 */
export interface ClientReportedSignals {
  readonly fingerprint: DeviceFingerprint;
  readonly automation: AutomationIndicators;
  /** Client clock at collection, ISO 8601. Compare against server time; a large skew is itself a signal. */
  readonly collectedAt: string;
}

/**
 * Reputation of the network the request actually arrived from.
 *
 * Server-observed: derived from the connection, not from the payload. The
 * client cannot change these by editing what it sends, only by genuinely
 * connecting from somewhere else — which is the point, because that has a
 * cost and editing a JSON field does not.
 */
export interface ServerObservedSignals {
  /** Autonomous System number the request arrived from. */
  readonly asn: number;
  /**
   * Whether the ASN is a hosting/VPN/proxy network rather than a consumer ISP.
   *
   * The highest-value single signal here, and still not a refusal on its
   * own: corporate VPNs and a good share of mobile carriers look like this,
   * and in Indonesia in particular a large share of legitimate mobile
   * traffic egresses through carrier infrastructure that classifies oddly.
   */
  readonly hostingProvider: boolean;
  /** Known-abusive reputation, 0 (clean) to 100 (worst). */
  readonly abuseScore: number;
}

/**
 * The whole picture, with provenance preserved.
 *
 * Both halves are required. That is the enforcement mechanism for this
 * file's central property: there is no way to construct a report that
 * silently contains only client claims, because the type will not let you.
 */
export interface DeviceSignalReport {
  readonly platform: DeviceSignalPlatform;
  readonly client: ClientReportedSignals;
  readonly server: ServerObservedSignals;
}

/**
 * The interface YT-0051 asks for. Web now, native later, one shape.
 *
 * Returns only the client half: a collector runs where the client runs and
 * cannot observe its own ASN — anything it claimed about its network would
 * be a client-reported value wearing a server-observed name, which is
 * precisely the confusion this file is built to prevent.
 */
export interface DeviceSignalCollector {
  readonly platform: DeviceSignalPlatform;
  collect(): Promise<ClientReportedSignals>;
}

/**
 * Milliseconds of client/server clock disagreement beyond which the skew is
 * worth recording as a signal.
 *
 * Five minutes: comfortably past ordinary unsynchronised-clock drift, well
 * short of the hours a replayed or hand-crafted payload tends to show.
 */
export const CLOCK_SKEW_SIGNAL_THRESHOLD_MS = 5 * 60 * 1000;

/**
 * How far the client's reported collection time is from the server's clock.
 *
 * Server-side on purpose. It takes the server's `now` as an argument rather
 * than calling `Date.now()` so it stays a pure function and so the caller
 * cannot accidentally compare two client-supplied times, which would always
 * agree and always mean nothing.
 */
export function clockSkewMs(client: ClientReportedSignals, serverNow: Date): number {
  const clientTime = Date.parse(client.collectedAt);
  if (Number.isNaN(clientTime)) return Number.POSITIVE_INFINITY;
  return Math.abs(serverNow.getTime() - clientTime);
}
