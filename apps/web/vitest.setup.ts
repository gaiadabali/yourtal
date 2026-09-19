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
