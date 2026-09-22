import { type Result, err, ok } from "neverthrow";
import { type BoundaryFailure, FaultEngine, failureFor } from "../fault-engine";
import type { FaultPlan } from "../faults";
import type { DriverMode, Environment } from "../driver-mode";
import { refuseLiveDriver } from "../live-driver";

/**
 * IP and ASN reputation for the address a request arrived from. YT-0051's
 * second criterion, server half.
 *
 * ## Why this is a boundary and the rest of YT-0051 is not
 *
 * Fingerprinting and headless detection run in the client and need no
 * vendor. Reputation is the one part that cannot be computed locally: it
 * needs somebody's view of which networks have been abusive lately, which
 * is a commercial data feed and therefore an external boundary with all the
 * failure modes `docs/08` cares about.
 *
 * ## An outage must not read as a clean reputation
 *
 * This is the single decision in this file worth arguing with, and it is
 * the inverse of the one `bot-check.ts` makes.
 *
 * There, a failed challenge is `ok({ passed: false })` — the call worked and
 * the answer was "not a human" — because an outage and a refusal need
 * opposite handling. Here the same reasoning points the other way: a lookup
 * that could not complete returns `err`, and there is **no default verdict**.
 *
 * If an unreachable provider resolved to `abuseScore: 0, hostingProvider:
 * false`, then knocking the reputation service over would make every
 * address on the internet look residential and clean. That is a cheap
 * attack with a large payoff, and it is invisible in logs that only record
 * the score. Forcing the caller to handle `err` means the decision of what
 * to do without reputation data is made once, explicitly, by someone who
 * knows what the registration flow should do — rather than defaulted to the
 * most permissive answer by omission.
 *
 * A caller that genuinely wants to proceed on a failed lookup can. It just
 * has to say so.
 */

/**
 * Addresses the simulator recognises. Documentation ranges (RFC 5737), so
 * they can never collide with a real address someone is testing against.
 */
export const SIMULATED_REPUTATION_IPS = {
  /** Ordinary consumer ISP. */
  residential: "192.0.2.1",
  /** Datacentre / VPN egress. */
  hosting: "192.0.2.2",
  /** Known-abusive. */
  abusive: "192.0.2.3",
  /** Carrier-grade NAT on a mobile network — legitimate, and classifies oddly. */
  mobileCarrier: "192.0.2.4",
} as const;

export interface DeviceReputation {
  /** Autonomous System number the request arrived from. */
  readonly asn: number;
  /**
   * Hosting/VPN/proxy network rather than a consumer ISP.
   *
   * The highest-value single signal available here and still not grounds
   * for refusal alone — corporate VPNs and a large share of Indonesian
   * mobile traffic egress through infrastructure that classifies this way.
   */
  readonly hostingProvider: boolean;
  /** 0 (clean) to 100 (worst). */
  readonly abuseScore: number;
}

export interface DeviceReputationDriver {
  readonly mode: DriverMode;
  /**
   * Looks up the address the connection came from.
   *
   * Takes the IP as an argument rather than reading it from anywhere,
   * because the only trustworthy source is the server's own view of the
   * socket. A driver that accepted a client-supplied address would turn a
   * server-observed signal into a client-reported one, which is the
   * distinction `@yourtal/contracts`'s `device-signals` module exists to
   * keep.
   */
  lookup(ip: string): Promise<Result<DeviceReputation, BoundaryFailure>>;
}

const SIMULATED: Record<string, DeviceReputation> = {
  [SIMULATED_REPUTATION_IPS.residential]: { asn: 7713, hostingProvider: false, abuseScore: 0 },
  [SIMULATED_REPUTATION_IPS.hosting]: { asn: 14061, hostingProvider: true, abuseScore: 15 },
  [SIMULATED_REPUTATION_IPS.abusive]: { asn: 9009, hostingProvider: true, abuseScore: 92 },
  // Deliberately present: a legitimate network that looks suspicious. A test
  // suite whose only "bad" case is unambiguously bad never exercises the
  // judgement the caller actually has to make.
  [SIMULATED_REPUTATION_IPS.mobileCarrier]: { asn: 23693, hostingProvider: true, abuseScore: 3 },
};

/**
 * Anything the simulator does not recognise.
 *
 * Residential and clean, matching the shape of the overwhelming majority of
 * real traffic, so a test that has not opted into a specific scenario gets
 * the ordinary case. This is a SIMULATOR default for unknown fixtures and
 * is not the outage path — an unreachable provider still returns `err`.
 */
const UNKNOWN_ADDRESS: DeviceReputation = { asn: 0, hostingProvider: false, abuseScore: 0 };

export function createSimulatedDeviceReputation(faultPlan?: FaultPlan): DeviceReputationDriver {
  const engine = new FaultEngine(faultPlan);

  return {
    mode: "simulated",
    lookup(ip: string): Promise<Result<DeviceReputation, BoundaryFailure>> {
      const directive = engine.nextCall();
      if (directive !== "proceed") {
        // No fallback verdict. See the header.
        return Promise.resolve(err(failureFor("device_reputation", directive)));
      }
      return Promise.resolve(ok(SIMULATED[ip] ?? UNKNOWN_ADDRESS));
    },
  };
}

export function createDeviceReputationDriver(
  mode: DriverMode,
  _env: Environment,
  faultPlan?: FaultPlan,
): DeviceReputationDriver {
  return mode === "simulated"
    ? createSimulatedDeviceReputation(faultPlan)
    : refuseLiveDriver("device_reputation");
}
