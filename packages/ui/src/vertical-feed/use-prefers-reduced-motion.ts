import * as React from "react";

/** Feature-detected: jsdom and older browsers have no `matchMedia`, so absence reads as "no preference". */
function readPrefersReducedMotion(): boolean {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
    return false;
  }
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/** Live — flips if the OS setting changes while the page is open, not just on first render. */
export function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = React.useState(readPrefersReducedMotion);

  React.useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
      return;
    }
    const mql = window.matchMedia("(prefers-reduced-motion: reduce)");
    const listener = () => setReduced(mql.matches);
    mql.addEventListener("change", listener);
    return () => mql.removeEventListener("change", listener);
  }, []);

  return reduced;
}
