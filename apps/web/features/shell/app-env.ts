/**
 * Server-side only. Static public pages read this at build time, so a staging
 * artifact must be built with `APP_ENV=staging` as well as run with it.
 */
export function isStaging(): boolean {
  return process.env["APP_ENV"] === "staging";
}
