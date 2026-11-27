import { MailError } from "@yourtal/mail-engine";
import type { MailErrorCode, MailSession } from "@yourtal/mail-engine";
import type { ApiError, ApiResult } from "@/lib/api/api-fetch";

/** How a failed token mint reads to the engine, so its hooks pick the right words. */
export function mailErrorCodeFor(error: ApiError): MailErrorCode {
  if (error.kind === "network") return "network";
  if (error.kind === "invalid_response") return "unavailable";
  if (error.status === 401) return "unauthorized";
  if (error.status === 429 || error.code === "rate_limited") return "rate_limited";
  if (error.code === "not_enabled" || error.code === "not_allowed" || error.status === 403) {
    return "not_enabled";
  }
  return "unavailable";
}

/** The `getSession` the engine is given: unwraps the Server Action's result, or throws a `MailError`. */
export async function sessionFrom(
  mint: () => Promise<ApiResult<MailSession>>,
): Promise<MailSession> {
  let result: ApiResult<MailSession>;
  try {
    result = await mint();
  } catch {
    throw new MailError("network", "network");
  }
  if (result.ok) return result.data;
  const code = mailErrorCodeFor(result.error);
  throw new MailError(
    code,
    result.error.message,
    result.error.kind === "http" ? { status: result.error.status } : {},
  );
}
