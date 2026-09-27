"use client";

/**
 * 6.9.b: tells `app/sw.ts` to drop every session-scoped runtime cache (the
 * wallet, the voucher pass, any other authenticated page) — see that
 * file's own doc comment for why a service worker cannot detect a session
 * boundary itself (it never sees the `Cookie` header, and login/logout run
 * as server-side Server Actions the browser's own fetch layer never
 * touches directly), so the place that DOES know a session just ended
 * (`logout-button.tsx`) tells it explicitly instead.
 *
 * The other half of this boundary — a FRESH login on a device that still
 * has a previous session's pages cached, with no logout in between — is
 * not wired yet: today's only working sign-in form is `/dev/login`
 * (`apps/web/app/dev/**`, Area A's reviewer tool, 1.7.e), not this
 * feature's to edit. Once the real sign-in page lands (6.2.a, `(auth)/**`),
 * it should call this same function on submit, for the same reason
 * `logout-button.tsx` does — there is nothing left to sign back into
 * cleanly if a stale cache can still answer for the account that logged in
 * before it.
 *
 * Fire-and-forget and silent-if-unsupported on purpose: a browser with no
 * active service worker (no controller yet, or SW support disabled) has no
 * stale cache to clear either, so there is nothing to wait for or report.
 */
export function clearSessionScopedServiceWorkerCache(): void {
  if (!("serviceWorker" in navigator)) return;
  navigator.serviceWorker.controller?.postMessage({ type: "yt-clear-session-cache" });
}
