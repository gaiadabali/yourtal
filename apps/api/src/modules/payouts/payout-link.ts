import { HttpException, HttpStatus, Logger, ServiceUnavailableException } from "@nestjs/common";
import type { Result } from "neverthrow";
import type { PayoutLink } from "@yourtal/contracts/billing/payouts";
import type { BoundaryFailure } from "@yourtal/drivers/fault-engine";

const logger = new Logger("PayoutLink");

/** The onboarding link, or the HTTP answer for a processor that refused or did not answer. */
export function linkOrThrow(
  result: Result<{ readonly url: string }, BoundaryFailure>,
  who: string,
): PayoutLink {
  if (result.isOk()) return { url: result.value.url };
  logger.warn(`payout onboarding link for ${who} failed: ${result.error.detail}`);
  if (result.error.kind === "declined") {
    throw new HttpException(
      { code: "payouts_refused", message: "The payout details page could not be opened." },
      HttpStatus.UNPROCESSABLE_ENTITY,
    );
  }
  throw new ServiceUnavailableException({
    code: "payouts_unavailable",
    message: "The payout details page could not be opened. Try again.",
  });
}
