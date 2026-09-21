import "@testing-library/jest-dom/vitest";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import idID from "@/messages/id-ID/store.json";
import { RegionProvider } from "@/features/region/region-context";
import { StoreBoardControls } from "./store-board-controls";

const push = vi.fn();
let searchParams = new URLSearchParams();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push }),
  usePathname: () => "/store",
  useSearchParams: () => searchParams,
}));

const locationOptions = ["Kemang", "Menteng"];
const merchantOptions = [
  { id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", name: "Ayam Berkah" },
  { id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", name: "Zeta Kopi" },
];

/**
 * `StoreBoardControls` reads the region ambiently via `useRegion()` (YT-0405)
 * for its category-option labels, and — since YT-0405's final pass — its own
 * filter-bar copy via `useTranslations("store")`, so it needs the intl
 * provider too. It is a genuine Client Component (router, `useId`), which is
 * why it uses the hook rather than the synchronous translator its Server
 * Component siblings take a `locale` prop for.
 */
function renderControls() {
  return render(
    <NextIntlClientProvider locale="id-ID" messages={{ store: idID }}>
      <RegionProvider region="ID">
        <StoreBoardControls locationOptions={locationOptions} merchantOptions={merchantOptions} />
      </RegionProvider>
    </NextIntlClientProvider>,
  );
}

beforeEach(() => {
  push.mockClear();
  searchParams = new URLSearchParams();
});

describe("StoreBoardControls", () => {
  it("renders all four filters as labelled comboboxes", () => {
    renderControls();
    expect(screen.getByRole("combobox", { name: "Kategori" })).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "Harga" })).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "Lokasi" })).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "Merchant" })).toBeInTheDocument();
  });

  it("lists the given location and merchant options", () => {
    renderControls();
    expect(screen.getByRole("option", { name: "Kemang" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "Zeta Kopi" })).toBeInTheDocument();
  });

  it("navigates via router.push when a filter changes, preserving the pathname", async () => {
    renderControls();
    fireEvent.change(screen.getByRole("combobox", { name: "Kategori" }), {
      target: { value: "retail" },
    });
    await waitFor(() => expect(push).toHaveBeenCalledWith("/store?category=retail"));
  });

  it("preserves an existing filter when only a different one changes", async () => {
    searchParams = new URLSearchParams("category=retail");
    renderControls();
    fireEvent.change(screen.getByRole("combobox", { name: "Lokasi" }), {
      target: { value: "Kemang" },
    });
    await waitFor(() =>
      expect(push).toHaveBeenCalledWith("/store?category=retail&location=Kemang"),
    );
  });

  it("does not show a reset link when no filter is active", () => {
    renderControls();
    expect(screen.queryByRole("link", { name: /hapus semua filter/i })).not.toBeInTheDocument();
  });

  it("shows a reset link to the bare route when a filter is active", () => {
    searchParams = new URLSearchParams("category=retail");
    renderControls();
    expect(screen.getByRole("link", { name: /hapus semua filter/i })).toHaveAttribute(
      "href",
      "/store",
    );
  });
});
