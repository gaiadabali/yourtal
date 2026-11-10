import { describe, expect, it } from "vitest";
import type { MeResponse } from "@/lib/api/me-schema";
import { guardianNoticeFor } from "./awaiting-guardian-notice";

const me = (flags: Partial<MeResponse>) => ({ ok: true, data: flags as MeResponse }) as const;

describe("guardianNoticeFor (5.13.v, 5.13.ai)", () => {
  it("waits for a pending teen, turns off a withdrawn one, and shows nothing otherwise", () => {
    expect(guardianNoticeFor(me({ awaitingGuardian: true }))).toBe("teenWaiting");
    expect(guardianNoticeFor(me({ awaitingGuardian: false, guardianWithdrawn: true }))).toBe(
      "teenWithdrawn",
    );
    expect(guardianNoticeFor(me({ awaitingGuardian: false, guardianWithdrawn: false }))).toBeNull();
    expect(guardianNoticeFor(me({}))).toBeNull();
    expect(guardianNoticeFor({ ok: false } as never)).toBeNull();
  });
});
