"use client";

/** A full navigation, never a fetch or a form post: the CSP has `form-action 'self'`, and the provider answers with redirects. */
export function navigateTo(url: string): void {
  window.location.assign(url);
}
