/**
 * Routes that stay public once the app requires sign-in, so the gate needs no
 * session. `/login` joins when the auth screens land; each `(lab)` page joins with it.
 */
export const GATE_ROUTES = ["/", "/au", "/id", "/au/rewards", "/id/rewards", "/lab/ui"] as const;

export const THEMES = ["light", "dark"] as const;
