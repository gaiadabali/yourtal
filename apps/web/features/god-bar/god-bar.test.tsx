import "@testing-library/jest-dom/vitest";
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ViewerShell } from "@/features/shell/viewer-shell";
import { GodAppsMenu } from "./god-apps-menu";

vi.mock("next/navigation", () => ({ usePathname: () => "/home" }));

async function openPanel(adult: boolean, locale: "en-AU" | "id-ID" = "en-AU") {
  const user = userEvent.setup();
  render(
    <GodAppsMenu
      locale={locale}
      label={locale === "en-AU" ? "GOD apps" : "Aplikasi GOD"}
      adult={adult}
    />,
  );
  const button = screen.getByRole("button", {
    name: locale === "en-AU" ? "GOD apps" : "Aplikasi GOD",
  });
  await user.click(button);
  await screen.findByRole("dialog");
  return { user, button };
}

describe("the GOD app switcher", () => {
  it("is a real button that starts closed and loads nothing until pressed", () => {
    render(<GodAppsMenu locale="en-AU" label="GOD apps" adult />);
    const button = screen.getByRole("button", { name: "GOD apps" });
    expect(button).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("lists the brands for an adult, with the right links", async () => {
    const { button } = await openPanel(true);
    expect(button).toHaveAttribute("aria-expanded", "true");
    const dialog = screen.getByRole("dialog", { name: "GOD apps" });
    expect(dialog).toHaveTextContent("Scan and keep every receipt");
    expect(screen.getByRole("link", { name: /SnapApps/ })).toHaveAttribute(
      "href",
      "https://app.snapapps.gaiada.com",
    );
    expect(screen.getByRole("link", { name: /Free Tax Returns/ })).toHaveAttribute(
      "href",
      "https://freetaxreturns.com.au",
    );
    expect(screen.getByRole("link", { name: /Spambank/ })).toHaveAttribute("href", "/mail");
    expect(screen.getByRole("link", { name: "About GOD" })).toHaveAttribute(
      "href",
      "https://god.gaiada.com",
    );
  });

  it("marks the current app and does not link it", async () => {
    await openPanel(true);
    expect(screen.queryByRole("link", { name: /YourTal/ })).toBeNull();
    const current = screen.getByText("YourTal").closest("[aria-current]");
    expect(current).toHaveAttribute("aria-current", "true");
    expect(current).toHaveTextContent("You are here");
  });

  it("hides Spambank when the person is not an adult who may use it (teen, visitor)", async () => {
    await openPanel(false);
    expect(screen.queryByText("Spambank")).toBeNull();
    expect(screen.getByRole("link", { name: /SnapApps/ })).toBeInTheDocument();
    expect(screen.getAllByRole("link")).toHaveLength(3);
  });

  it("closes on Esc and puts focus back on the button", async () => {
    const { user, button } = await openPanel(true);
    expect(screen.getByRole("link", { name: /SnapApps/ })).toHaveFocus();
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(button).toHaveAttribute("aria-expanded", "false");
    expect(button).toHaveFocus();
  });

  it("keeps Tab inside the panel", async () => {
    const { user } = await openPanel(false);
    const about = screen.getByRole("link", { name: "About GOD" });
    about.focus();
    await user.tab();
    expect(screen.getByRole("link", { name: /SnapApps/ })).toHaveFocus();
    await user.tab({ shift: true });
    expect(about).toHaveFocus();
  });

  it("reads in Indonesian", async () => {
    await openPanel(true, "id-ID");
    expect(screen.getByText("Kamu di sini")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Tentang GOD" })).toBeInTheDocument();
  });
});

describe("the GOD bar in the shell", () => {
  it("adds the switcher and the 'A GOD company' link only when asked", () => {
    const { unmount } = render(
      <ViewerShell locale="en-AU" availablePoints={0}>
        <p>content</p>
      </ViewerShell>,
    );
    expect(screen.queryByRole("button", { name: "GOD apps" })).toBeNull();
    expect(screen.queryByRole("link", { name: "A GOD company" })).toBeNull();
    unmount();

    render(
      <ViewerShell locale="en-AU" availablePoints={0} godBar={{ adult: true }}>
        <p>content</p>
      </ViewerShell>,
    );
    expect(screen.getByRole("button", { name: "GOD apps" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "A GOD company" })).toHaveAttribute(
      "href",
      "https://god.gaiada.com",
    );
  });

  it("says it in Indonesian", () => {
    render(
      <ViewerShell locale="id-ID" availablePoints={0} godBar={{ adult: false }}>
        <p>content</p>
      </ViewerShell>,
    );
    expect(screen.getByRole("link", { name: "Bagian dari GOD" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Aplikasi GOD" })).toBeInTheDocument();
  });
});
