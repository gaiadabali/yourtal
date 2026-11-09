/** `/api/dev/*` answers 404 without `x-qa-key` (apps/api dev-qa-key.ts): export STAGING_QA_KEY from your .env to run these. */
export const QA_HEADERS: Record<string, string> = {
  "x-qa-key": process.env["STAGING_QA_KEY"] ?? "",
};
