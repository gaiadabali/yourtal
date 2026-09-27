/** Split from `devices.module.ts` so a controller can inject this token without importing the module file itself (checkout.tokens.ts's own pattern). */
export const DEVICES_DB = Symbol("DEVICES_DB");
