import { BOUNDARIES, type BoundaryName } from "./boundary";

/**
 * What `live` means while every third-party connection is held. YT-0535.
 *
 * ## Why `live` exists at all if nothing is connected
 *
 * It would be simpler to have only simulators and add `live` later. That
 * would be the wrong shape, because the rule "choosing `live` without its
 * credential fails at boot" cannot be written, let alone tested, against a
 * mode that does not exist. The seam has to be real before the vendor is, or
 * the first live integration is also the first time the seam is exercised.
 *
 * ## Why it throws rather than returning a failure
 *
 * A driver that returns "not implemented" from every call is a driver the
 * application boots with. It would run, serve traffic, and fail one request
 * at a time — indistinguishable from a vendor outage, and discovered by a
 * user rather than by a deploy.
 *
 * Throwing at construction means the process does not start. The credential
 * check in `driver-mode.ts` runs first, so the two failures are separable:
 * **"you did not set the key"** and **"there is no implementation yet"** are
 * different problems with different fixes, and a single message conflating
 * them sends somebody looking for a key that would not have helped.
 */
export class LiveDriverNotImplementedError extends Error {
  readonly boundary: BoundaryName;

  constructor(boundary: BoundaryName) {
    const definition = BOUNDARIES[boundary];
    super(
      `The ${boundary} boundary has no live driver yet, so ${definition.modeEnvVar}="live" ` +
        `cannot start. Credentials were present, which is why this is not a configuration error. ` +
        `Purpose: ${definition.purpose} Intended vendor: ${definition.liveVendor} ` +
        `Implemented by: ${definition.liveTicket}. ` +
        `Set ${definition.modeEnvVar}="simulated" to run against the simulator, deliberately.`,
    );
    this.name = "LiveDriverNotImplementedError";
    this.boundary = boundary;
  }
}

/**
 * The live constructor every boundary shares until its vendor lands.
 *
 * One function rather than eight identical bodies, so that implementing a
 * real driver is a visible deletion of this call rather than an edit that
 * looks like any other.
 */
export function refuseLiveDriver(boundary: BoundaryName): never {
  throw new LiveDriverNotImplementedError(boundary);
}
