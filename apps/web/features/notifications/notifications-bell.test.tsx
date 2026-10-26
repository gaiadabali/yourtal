import "@testing-library/jest-dom/vitest";
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import type { Notification } from "@yourtal/contracts/me/notification";
import shell from "@/messages/en-AU/shell.json";
import { NotificationsBell } from "./notifications-bell";

vi.mock("./notifications-actions", () => ({ markNotificationReadAction: vi.fn() }));

// 14:00 UTC is 01:00 on 1 Jan in Sydney but 21:00 on 31 Dec in Jakarta.
const AT = "2026-12-31T14:00:00.000Z";

function notification(region: "AU" | "ID", over: Partial<Notification> = {}): Notification {
  return {
    id: 1,
    userId: "u1",
    region,
    category: "goodwill",
    title: "Welcome",
    body: "Your first points are on their way.",
    createdAt: AT,
    readAt: null,
    ...over,
  };
}

async function open(items: readonly Notification[]) {
  render(
    <NextIntlClientProvider locale="en-AU" messages={{ shell }}>
      <NotificationsBell initialNotifications={items} />
    </NextIntlClientProvider>,
  );
  await userEvent.setup().click(screen.getByRole("button"));
}

describe("NotificationsBell", () => {
  it("says when each notification arrived, in its own region's zone", async () => {
    await open([notification("AU"), notification("ID", { id: 2 })]);
    const times = screen.getAllByText(/\d{1,2}:\d{2}/);
    expect(times).toHaveLength(2);
    expect(times[0]).toHaveTextContent("1 Jan");
    expect(times[1]).toHaveTextContent("31 Dec");
    expect(times[0]).toHaveAttribute("datetime", AT);
  });
});
