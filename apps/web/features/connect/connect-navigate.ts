"use client";

/** A full navigation, never a fetch or a form post: the CSP has `form-action 'self'`, and the provider answers with redirects. */
export function navigateTo(url: string): void {
  window.location.assign(url);
}

/** A real GET of the address in the bar, replacing the entry: the browser sends the cookies scoped to this path. */
export function reloadHere(): void {
  window.location.replace(window.location.href);
}
