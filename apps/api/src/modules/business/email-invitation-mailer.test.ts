import { describe, expect, it } from "vitest";
import { ok } from "neverthrow";
import type { EmailDriver, EmailMessage } from "@yourtal/drivers/email";
import type { AppConfig } from "../../config/app-config";
import { EmailInvitationMailer } from "./email-invitation-mailer";

function recording(): { driver: EmailDriver; sent: EmailMessage[] } {
  const sent: EmailMessage[] = [];
  return {
    sent,
    driver: {
      mode: "live",
      send: (message) => {
        sent.push(message);
        return Promise.resolve(ok({ id: "m1", route: "live" }));
      },
    },
  };
}

describe("EmailInvitationMailer (1.3.c)", () => {
  it("sends a plain invite with one absolute join link, the encoded token and the real expiry", async () => {
    const { driver, sent } = recording();
    const mailer = new EmailInvitationMailer(driver, {
      webOrigin: "https://yourtal.gaiada.com",
    } as AppConfig);

    await mailer.send({
      to: "marketer@example.com",
      region: "AU",
      businessDisplayName: "Kopi Kenangan",
      role: "marketer",
      token: "a+b/c=d e",
    });

    expect(sent).toHaveLength(1);
    const message = sent[0];
    expect(message?.subject).toBe("Join Kopi Kenangan on YourTal Studio");
    expect(message?.category).toBe("team_invitation");
    expect(message?.metadata).toEqual({ token: "a+b/c=d e", role: "marketer" });
    const body = message?.body ?? "";
    expect(body).toContain("https://yourtal.gaiada.com/studio/join?token=a%2Bb%2Fc%3Dd%20e\n");
    expect(body).not.toContain("a+b/c=d e");
    expect(body.match(/https?:\/\//g)).toHaveLength(1);
    expect(body).toContain(
      "Kopi Kenangan has added you to their team on YourTal Studio as marketer.",
    );
    expect(body).toContain("The invitation expires in 7 days.");
    expect(body).toContain("If you weren't expecting this, you can ignore this email.");
    expect(body.endsWith("YourTal · yourtal.gaiada.com")).toBe(true);
  });
});
