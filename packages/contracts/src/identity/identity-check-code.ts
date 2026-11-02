// Kept free of zod so a client component can import the code without pulling
// zod's runtime (~35 KB gz) into the player's first-load JS.
/** The stable code a refused earning carries: a watch session's `nonEarningReason`, a partner's error code. */
export const IDENTITY_CHECK_REQUIRED = "identity_check_required";
