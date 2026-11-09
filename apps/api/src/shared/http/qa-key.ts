import { createHash, timingSafeEqual } from "node:crypto";
import type { AppConfig } from "../../config/app-config";

/**
 * Staging test kit: does the request carry `STAGING_QA_KEY` as `x-qa-key`?
 * Never on production, never without a configured key. Both sides are hashed
 * so the compare is constant-time whatever the lengths.
 */
export function qaKeyValid(
  config: Pick<AppConfig, "appEnv" | "stagingQaKey">,
  given: string | string[] | undefined,
): boolean {
  const key = config.stagingQaKey;
  if (config.appEnv === "production" || key === undefined || key === "") return false;
  if (typeof given !== "string") return false;
  return timingSafeEqual(digest(given), digest(key));
}

function digest(value: string): Buffer {
  return createHash("sha256").update(value, "utf8").digest();
}
