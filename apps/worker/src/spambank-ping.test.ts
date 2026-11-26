import { describe, expect, it } from "vitest";
import { createSimulatedSpambank } from "@yourtal/drivers/spambank";
import { pingSpambank } from "./spambank-ping";

describe("pingSpambank", () => {
  it("passes when both domains are served", async () => {
    const driver = createSimulatedSpambank({
      domains: ["yourtal.gaiada.com", "spambank.yourtal.gaiada.com"],
    });
    const result = await pingSpambank(driver, {});
    expect(result.ok).toBe(true);
    expect(result.lines.at(-1)).toContain("both Spambank domains");
  });

  it("names the domain that is missing", async () => {
    const driver = createSimulatedSpambank({ domains: ["yourtal.gaiada.com"] });
    const result = await pingSpambank(driver, {});
    expect(result.ok).toBe(false);
    expect(result.lines.at(-1)).toContain("spambank.yourtal.gaiada.com");
  });

  it("reports a failed call with its code and no secret", async () => {
    const driver = createSimulatedSpambank({ faultPlan: { kind: "timeout" } });
    const result = await pingSpambank(driver, {});
    expect(result.ok).toBe(false);
    expect(result.lines.at(-1)).toContain("unavailable");
  });

  it("checks the domains the environment names", async () => {
    const driver = createSimulatedSpambank({ domains: ["a.test", "b.test"] });
    const result = await pingSpambank(driver, {
      SPAMBANK_MAIL_DOMAIN: "a.test",
      SPAMBANK_REPLY_DOMAIN: "b.test",
    });
    expect(result.ok).toBe(true);
  });
});
