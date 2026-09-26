import "@testing-library/jest-dom/vitest";
import type { ReactElement } from "react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { act, render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import idID from "@/messages/id-ID/quick.json";
import { QuickFeedViewport } from "./quick-feed-viewport";

/** `QuickFeedViewport` reads its list's `aria-label` from `useTranslations("quick")` (YT-0405). */
function renderViewport(ui: ReactElement) {
  return render(
    <NextIntlClientProvider locale="id-ID" messages={{ quick: idID }}>
      {ui}
    </NextIntlClientProvider>,
  );
}

/**
 * jsdom implements no `IntersectionObserver` at all, and cannot produce
 * real scroll geometry or intersection ratios either way — see this
 * ticket's report for what a real browser pass still needs to verify
 * (actual scroll-snap behaviour, real intersection timing). This stub is
 * local to this test file, not the shared `apps/web/vitest.setup.ts`
 * (outside this ticket's file ownership): it records every observed
 * element and lets a test invoke the real callback directly with
 * hand-built entries.
 */
class FakeIntersectionObserver implements IntersectionObserver {
  readonly root: Element | Document | null = null;
  readonly rootMargin = "";
  readonly scrollMargin = ""; // new in TS 6's updated lib.dom.d.ts
  readonly thresholds: readonly number[] = [];
  static instances: FakeIntersectionObserver[] = [];
  readonly callback: IntersectionObserverCallback;
  observed: Element[] = [];

  constructor(callback: IntersectionObserverCallback) {
    this.callback = callback;
    FakeIntersectionObserver.instances.push(this);
  }
  observe(target: Element) {
    this.observed.push(target);
  }
  unobserve(target: Element) {
    this.observed = this.observed.filter((element) => element !== target);
  }
  disconnect() {
    this.observed = [];
  }
  takeRecords(): IntersectionObserverEntry[] {
    return [];
  }
}

/** Only the three fields quick-feed-viewport.tsx actually reads from an entry. */
function fakeEntry(target: Element, intersectionRatio: number): IntersectionObserverEntry {
  return {
    target,
    isIntersecting: intersectionRatio > 0,
    intersectionRatio,
  } as unknown as IntersectionObserverEntry;
}

describe("QuickFeedViewport", () => {
  beforeEach(() => {
    FakeIntersectionObserver.instances = [];
    globalThis.IntersectionObserver = FakeIntersectionObserver;
  });

  afterEach(() => {
    // @ts-expect-error -- test-only removal of the global stubbed above.
    delete globalThis.IntersectionObserver;
  });

  it("renders its children inside an accessible, labelled feed list", () => {
    renderViewport(
      <QuickFeedViewport>
        <li data-quick-feed-item data-quick-feed-label="Video 1 dari 1: Toko — Judul">
          Item
        </li>
      </QuickFeedViewport>,
    );
    expect(screen.getByRole("list", { name: "Feed Quick" })).toBeInTheDocument();
    expect(screen.getByText("Item")).toBeInTheDocument();
  });

  it("starts with no position announced until an item actually settles into view", () => {
    renderViewport(
      <QuickFeedViewport>
        <li data-quick-feed-item data-quick-feed-label="Video 1 dari 1: Toko — Judul">
          Item
        </li>
      </QuickFeedViewport>,
    );
    expect(screen.getByRole("status")).toHaveTextContent("");
  });

  it("announces the most-visible item's label through a polite status region", () => {
    renderViewport(
      <QuickFeedViewport>
        <li data-quick-feed-item data-quick-feed-label="Video 1 dari 2: Toko A — Judul A">
          A
        </li>
        <li data-quick-feed-item data-quick-feed-label="Video 2 dari 2: Toko B — Judul B">
          B
        </li>
      </QuickFeedViewport>,
    );

    const observer = FakeIntersectionObserver.instances[0];
    expect(observer).toBeDefined();
    const [firstItem, secondItem] = observer!.observed;

    act(() => {
      observer!.callback(
        [fakeEntry(secondItem!, 0.9), fakeEntry(firstItem!, 0.1)],
        observer as unknown as IntersectionObserver,
      );
    });

    expect(screen.getByRole("status")).toHaveTextContent("Video 2 dari 2: Toko B — Judul B");
  });

  it("never mounts a video element or anything else that could play on its own", () => {
    const { container } = renderViewport(
      <QuickFeedViewport>
        <li data-quick-feed-item data-quick-feed-label="Video 1 dari 1: Toko — Judul">
          Item
        </li>
      </QuickFeedViewport>,
    );
    expect(container.querySelector("video")).not.toBeInTheDocument();
    expect(container.querySelector("audio")).not.toBeInTheDocument();
  });

  it("does not throw and still renders children when IntersectionObserver is unavailable", () => {
    // @ts-expect-error -- deliberately simulating an environment without it.
    delete globalThis.IntersectionObserver;
    renderViewport(
      <QuickFeedViewport>
        <li data-quick-feed-item data-quick-feed-label="Video 1 dari 1: Toko — Judul">
          Item
        </li>
      </QuickFeedViewport>,
    );
    expect(screen.getByText("Item")).toBeInTheDocument();
  });
});
