import { describe, expect, it } from "vitest";
import type { Notification } from "@yourtal/contracts/me/notification";
import { notificationCopy, type CopyTools } from "./notification-copy";
import enShell from "../../messages/en-AU/shell.json";
import idShell from "../../messages/id-ID/shell.json";

function note(overrides: Partial<Notification>): Notification {
  return {
    id: 1,
    userId: "u1",
    region: "AU",
    category: "voucher_expiring",
    title: "Voucher ending soon",
    body: "Your Flat white voucher ends on 2026-10-12.",
    metadata: { rewardTitle: "Flat white", expiresAt: "2026-10-12T01:00:00.000Z" },
    createdAt: "2026-10-09T01:00:00.000Z",
    readAt: null,
    ...overrides,
  };
}

function tools(messages: typeof enShell.notifications): CopyTools {
  return {
    voucherExpiringTitle: messages.voucherExpiringTitle,
    voucherExpiringBody: (reward, endsAt) =>
      messages.voucherExpiringBody
        .replace("{reward}", reward)
        .replace("{date}", endsAt.toISOString().slice(0, 10)),
  };
}

describe("notificationCopy", () => {
  it("words a voucher warning from the catalogue in either language", () => {
    expect(notificationCopy(note({}), tools(enShell.notifications))).toEqual({
      title: "Voucher ending soon",
      body: "Your Flat white voucher ends on 2026-10-12.",
    });
    expect(notificationCopy(note({}), tools(idShell.notifications))).toEqual({
      title: "Voucher segera berakhir",
      body: "Voucher Flat white Anda berakhir pada 2026-10-12.",
    });
  });

  it("shows the stored text for other categories and for incomplete metadata", () => {
    const other = note({ category: "points_unlocked", title: "Points unlocked", body: "5 pts" });
    expect(notificationCopy(other, tools(idShell.notifications))).toEqual({
      title: "Points unlocked",
      body: "5 pts",
    });
    const broken = note({ metadata: { rewardTitle: "Flat white", expiresAt: "not a date" } });
    expect(notificationCopy(broken, tools(idShell.notifications)).title).toBe(
      "Voucher ending soon",
    );
    expect(notificationCopy(note({ metadata: {} }), tools(idShell.notifications)).body).toBe(
      "Your Flat white voucher ends on 2026-10-12.",
    );
  });
});
