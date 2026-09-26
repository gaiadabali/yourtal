import "@testing-library/jest-dom/vitest";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { VerticalFeed, type VerticalFeedItemState } from "./vertical-feed";

interface DemoItem {
  id: string;
  title: string;
}

function buildItems(count: number): DemoItem[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `item-${index}`,
    title: `Item ${index}`,
  }));
}

/**
 * jsdom implements no `IntersectionObserver` at all and cannot produce real
 * scroll geometry — this stub (same pattern as
 * `apps/web/features/quick/quick-feed-viewport.test.tsx`) records every
 * observed element and lets a test invoke the real callback with hand-built
 * entries.
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
    this.observed = this.observed.filter((el) => el !== target);
  }
  disconnect() {
    this.observed = [];
  }
  takeRecords(): IntersectionObserverEntry[] {
    return [];
  }
}

function fakeEntry(target: Element, intersectionRatio: number): IntersectionObserverEntry {
  return {
    target,
    isIntersecting: intersectionRatio > 0,
    intersectionRatio,
  } as unknown as IntersectionObserverEntry;
}

function settleOn(index: number) {
  const observer = FakeIntersectionObserver.instances.at(-1);
  if (!observer) return;
  const entries = observer.observed.map((el) =>
    fakeEntry(el, Number(el.getAttribute("data-vf-index")) === index ? 1 : 0),
  );
  act(() => {
    observer.callback(entries, observer);
  });
}

function renderFeed(overrides: Partial<Parameters<typeof VerticalFeed<DemoItem>>[0]> = {}) {
  const items = overrides.items ?? buildItems(10);
  return render(
    <VerticalFeed
      items={items}
      mode="teaser"
      label="For You"
      endSlot={<p>You&apos;re all caught up</p>}
      renderItem={(item, state) => (
        <div
          data-testid={`render-${item.id}`}
          data-mounted={state.mounted}
          data-active={state.active}
        >
          {item.title}
        </div>
      )}
      {...overrides}
    />,
  );
}

describe("VerticalFeed", () => {
  beforeAll(() => {
    // jsdom implements no `scrollIntoView` at all (see
    // apps/web/vitest.setup.ts's own comment on the same gap for Radix) —
    // this package has no shared setup file, so the stub lives here.
    if (!Element.prototype.scrollIntoView) {
      Element.prototype.scrollIntoView = vi.fn();
    }
  });

  beforeEach(() => {
    FakeIntersectionObserver.instances = [];
    globalThis.IntersectionObserver = FakeIntersectionObserver;
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null)));
  });

  afterEach(() => {
    // @ts-expect-error -- test-only removal of the global stubbed above.
    delete globalThis.IntersectionObserver;
    vi.unstubAllGlobals();
    // @ts-expect-error -- test-only removal of a per-test navigator.connection stub.
    delete globalThis.navigator.connection;
  });

  it("renders an accessible, labelled region and every item plus the end slot", () => {
    renderFeed();
    expect(screen.getByRole("region", { name: "For You" })).toBeInTheDocument();
    expect(screen.getByText("You're all caught up")).toBeInTheDocument();
  });

  it("mounts only the active item and its immediate neighbours (at most 3), never more", () => {
    renderFeed({ items: buildItems(10) });
    settleOn(5);

    for (let index = 0; index < 10; index += 1) {
      const el = screen.getByTestId(`render-item-${index}`);
      const shouldBeMounted = Math.abs(index - 5) <= 1;
      expect(el.dataset["mounted"]).toBe(String(shouldBeMounted));
    }
  });

  it("moves the mounted window as the active item changes", () => {
    renderFeed({ items: buildItems(10) });
    settleOn(0);
    expect(screen.getByTestId("render-item-0").dataset["mounted"]).toBe("true");
    expect(screen.getByTestId("render-item-2").dataset["mounted"]).toBe("false");

    settleOn(3);
    expect(screen.getByTestId("render-item-0").dataset["mounted"]).toBe("false");
    expect(screen.getByTestId("render-item-2").dataset["mounted"]).toBe("true");
    expect(screen.getByTestId("render-item-3").dataset["mounted"]).toBe("true");
    expect(screen.getByTestId("render-item-4").dataset["mounted"]).toBe("true");
  });

  it("calls onActiveChange with the settled index and item", () => {
    const onActiveChange = vi.fn();
    renderFeed({ items: buildItems(5), onActiveChange });
    settleOn(2);
    expect(onActiveChange).toHaveBeenLastCalledWith(2, { id: "item-2", title: "Item 2" });
  });

  it("moves the active item on ArrowDown/ArrowUp and PageDown/PageUp", () => {
    renderFeed({ items: buildItems(5) });
    const region = screen.getByRole("region", { name: "For You" });

    fireEvent.keyDown(region, { key: "ArrowDown" });
    expect(screen.getByTestId("render-item-0").dataset["active"]).toBe("false");
    expect(screen.getByTestId("render-item-1").dataset["active"]).toBe("true");

    fireEvent.keyDown(region, { key: "PageDown" });
    expect(screen.getByTestId("render-item-2").dataset["active"]).toBe("true");

    fireEvent.keyDown(region, { key: "ArrowUp" });
    expect(screen.getByTestId("render-item-1").dataset["active"]).toBe("true");
  });

  it("passes mode through to renderItem's state", () => {
    const states: VerticalFeedItemState[] = [];
    render(
      <VerticalFeed
        items={buildItems(2)}
        mode="inline-session"
        label="Feed"
        endSlot={null}
        renderItem={(item, state) => {
          states.push(state);
          return <div key={item.id} />;
        }}
      />,
    );
    expect(states.every((state) => state.mode === "inline-session")).toBe(true);
  });

  describe("preload rule", () => {
    it("fetches the next item's first 300 KB (Range header) when off cellular and saveData is false", () => {
      const fetchMock = vi.fn().mockResolvedValue(new Response(null));
      vi.stubGlobal("fetch", fetchMock);
      Object.defineProperty(globalThis.navigator, "connection", {
        value: { type: "wifi", saveData: false },
        configurable: true,
      });

      renderFeed({
        items: buildItems(5),
        preloadSrc: (item) => `https://example.test/${item.id}.mp4`,
      });
      settleOn(0);

      expect(fetchMock).toHaveBeenCalledWith("https://example.test/item-1.mp4", {
        headers: { Range: "bytes=0-307199" },
      });
    });

    it("never preloads on a cellular connection", () => {
      const fetchMock = vi.fn().mockResolvedValue(new Response(null));
      vi.stubGlobal("fetch", fetchMock);
      Object.defineProperty(globalThis.navigator, "connection", {
        value: { type: "cellular", saveData: false },
        configurable: true,
      });

      renderFeed({
        items: buildItems(5),
        preloadSrc: (item) => `https://example.test/${item.id}.mp4`,
      });
      settleOn(0);

      expect(fetchMock).not.toHaveBeenCalled();
    });

    it("never preloads when saveData is true, even off cellular", () => {
      const fetchMock = vi.fn().mockResolvedValue(new Response(null));
      vi.stubGlobal("fetch", fetchMock);
      Object.defineProperty(globalThis.navigator, "connection", {
        value: { type: "wifi", saveData: true },
        configurable: true,
      });

      renderFeed({
        items: buildItems(5),
        preloadSrc: (item) => `https://example.test/${item.id}.mp4`,
      });
      settleOn(0);

      expect(fetchMock).not.toHaveBeenCalled();
    });

    it("preloads when the Network Information API is unavailable entirely", () => {
      const fetchMock = vi.fn().mockResolvedValue(new Response(null));
      vi.stubGlobal("fetch", fetchMock);

      renderFeed({
        items: buildItems(5),
        preloadSrc: (item) => `https://example.test/${item.id}.mp4`,
      });
      settleOn(0);

      expect(fetchMock).toHaveBeenCalled();
    });

    it("never fetches when there is no next item (last item active)", () => {
      const fetchMock = vi.fn().mockResolvedValue(new Response(null));
      vi.stubGlobal("fetch", fetchMock);

      renderFeed({
        items: buildItems(3),
        preloadSrc: (item) => `https://example.test/${item.id}.mp4`,
      });
      // Mounting at the default active=0 already preloads item 1 — clear
      // that before settling on the actual last item, which is what this
      // test means to check.
      fetchMock.mockClear();
      settleOn(2);

      expect(fetchMock).not.toHaveBeenCalled();
    });
  });
});
