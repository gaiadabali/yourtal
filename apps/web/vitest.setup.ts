import { configure } from "@testing-library/react";

/**
 * YT-0577: Testing Library's `findBy*`/`waitFor` polling defaults to a
 * 1000ms `asyncUtilTimeout`. Reproduced under load (CPU burners pegging
 * every core alongside `pnpm test`): that default is blown by ordinary
 * scheduler contention, not only by `next/dynamic` chunk loading. It hit
 * `video-player.test.tsx`'s dynamically-imported resume prompt and quality
 * selector, but identically hit `team-screen.test.tsx`'s plain (no
 * `next/dynamic` anywhere in that component) Radix dialogs on a different
 * run — same default, same failure shape, no dynamic import involved. The
 * full audit of every `findBy*`/`waitFor` site in this suite is in this
 * ticket's report; several of them (`campaign-board-controls.test.tsx`,
 * `streak-check-in-card.test.tsx`, `voucher-qr-canvas.test.tsx`, …) have
 * never failed yet but share the exact same exposure and would eventually
 * take their turn as the machine's contention shifts.
 *
 * Set once, globally, rather than per call site — a per-site bump (as
 * `merchant-redemption-screen.test.tsx` already tried, at 3000ms, before
 * this change) only ever covers the sites that happened to fail on the
 * run that found them, and still wasn't enough under heavier load. This
 * value is deliberately generous rather than tuned to "just barely enough
 * on this machine": see `vitest.config.ts` for the other half of the fix
 * (bounding worker-thread count so contention is reduced, not just waited
 * through).
 */
configure({ asyncUtilTimeout: 5_000 });

// Shared jsdom polyfills for Radix primitives used across this app's tests.
// jsdom implements none of ResizeObserver, pointer capture or
// scrollIntoView, all of which various Radix packages call unconditionally
// in their pointer/keyboard handling (Slider, Select, RadioGroup, Sheet's
// underlying Dialog). Centralized here rather than repeated per test file —
// see packages/ui/src/select/select.test.tsx for the original pattern this
// generalizes.
if (typeof globalThis.ResizeObserver === "undefined") {
  class ResizeObserverPolyfill {
    observe() {
      // no-op — nothing in these tests depends on real layout measurement.
    }
    unobserve() {
      // no-op
    }
    disconnect() {
      // no-op
    }
  }
  globalThis.ResizeObserver = ResizeObserverPolyfill as unknown as typeof ResizeObserver;
}

if (!Element.prototype.hasPointerCapture) {
  Element.prototype.hasPointerCapture = () => false;
}
if (!Element.prototype.setPointerCapture) {
  Element.prototype.setPointerCapture = () => {};
}
if (!Element.prototype.releasePointerCapture) {
  Element.prototype.releasePointerCapture = () => {};
}
if (!Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = () => {};
}
