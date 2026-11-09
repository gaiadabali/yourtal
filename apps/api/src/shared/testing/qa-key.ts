/** The `x-qa-key` header every `/api/dev/*` request needs (vitest.config.ts sets the key). */
export const QA = { "x-qa-key": process.env["STAGING_QA_KEY"] ?? "" } as const;
