import { describe, expect, it } from "vitest";
import { auBusinessFixture as businessMock } from "@yourtal/contracts/business/business.mock";
import type {
  BusinessAccountRepository,
  UpdateChannelOutcome,
} from "../persistence/business-account.repository";
import { updateChannelSettings } from "./update-channel-settings.use-case";

const INPUT = {
  businessId: businessMock.id,
  displayName: "New name",
  handle: "new-handle",
  logoUrl: null,
  coverUrl: null,
};

function repo(outcome: UpdateChannelOutcome): BusinessAccountRepository {
  return { findById: () => Promise.resolve(null), updateChannel: () => Promise.resolve(outcome) };
}

describe("updateChannelSettings", () => {
  it("returns the updated business", async () => {
    const updated = { ...businessMock, displayName: "New name", handle: "new-handle" };
    const result = await updateChannelSettings(repo(updated), INPUT);
    expect(result._unsafeUnwrap()).toStrictEqual(updated);
  });

  it("reports a handle another business already uses", async () => {
    const result = await updateChannelSettings(repo("handle_taken"), INPUT);
    expect(result._unsafeUnwrapErr()).toStrictEqual({ type: "handle_taken", handle: "new-handle" });
  });

  it("reports an unknown business", async () => {
    const result = await updateChannelSettings(repo(null), INPUT);
    expect(result._unsafeUnwrapErr().type).toBe("business_not_found");
  });
});
