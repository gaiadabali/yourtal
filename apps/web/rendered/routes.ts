/**
 * Routes that stay public once the app requires sign-in, so the gate needs no
 * session. `/login` joins when the auth screens land; each `(lab)` page joins with it.
 */
export const GATE_ROUTES = [
  "/",
  "/au",
  "/id",
  "/au/rewards",
  "/id/rewards",
  "/lab/ui",
  // The prototypes pick their theme from the URL, not the OS.
  "/lab/after-dark",
  "/lab/after-dark?theme=light",
  "/lab/daylight",
  "/lab/daylight?theme=dark",
] as const;

export const THEMES = ["light", "dark"] as const;
