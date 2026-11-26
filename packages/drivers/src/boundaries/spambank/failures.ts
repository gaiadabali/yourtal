import { failureFor } from "../../fault-engine";
import type { CallDirective } from "../../fault-engine";
import type { SpambankFailure, SpambankFailureCode } from "./types";

const BOUNDARY = "spambank";

/** Long enough to read an error type, too short to carry a payload someone forgot was a secret. */
const DETAIL_MAX = 160;

function clip(detail: string): string {
  return detail.length > DETAIL_MAX ? `${detail.slice(0, DETAIL_MAX)}...` : detail;
}

/** Stalwart was reached (or not) and the answer is "try again later". */
export function unavailable(detail: string): SpambankFailure {
  return { ...failureFor(BOUNDARY, "server_error"), detail: clip(detail), code: "unavailable" };
}

export function timedOut(): SpambankFailure {
  return { ...failureFor(BOUNDARY, "timeout"), code: "unavailable" };
}

/** A definite "no": nothing was done on the far side. */
export function refused(
  code: Exclude<SpambankFailureCode, "unavailable">,
  detail: string,
): SpambankFailure {
  return { ...failureFor(BOUNDARY, "decline"), detail: clip(detail), code };
}

/** What a fault plan's directive looks like through this boundary. */
export function injected(directive: Exclude<CallDirective, "proceed">): SpambankFailure {
  const base = failureFor(BOUNDARY, directive);
  return { ...base, code: directive === "decline" ? "rejected" : "unavailable" };
}
