/**
 * The app-password limits of `@yourtal/contracts/spambank/management`, repeated here as plain
 * numbers: that file also holds the zod schemas, and importing a value from it would put zod's
 * runtime into Me's first load. `mail-pure.test.ts` fails if the two ever differ.
 */
export const APP_PASSWORDS_MAX = 5;
export const APP_PASSWORD_NAME_MAX = 40;
