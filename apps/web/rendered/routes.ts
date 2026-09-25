/**
 * Routes that stay public now the app requires sign-in, so the gate needs no
 * session. `/` redirects to `/au` when signed out. `/login` joins when the
 * auth screens land; each `(lab)` page joins with it.
 */
export const GATE_ROUTES = [
  "/",
  "/au",
  "/id",
  "/au/rewards",
  "/id/rewards",
  "/lab/ui",
  "/lab/shell",
] as const;

export const THEMES = ["light", "dark"] as const;
