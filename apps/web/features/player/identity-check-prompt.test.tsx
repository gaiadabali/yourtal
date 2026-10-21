import "@testing-library/jest-dom/vitest";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { campaignSchema } from "@yourtal/contracts/campaign";
import { campaignTermsSchema } from "@yourtal/contracts/campaign/terms";
import { IdentityCheckPrompt } from "./identity-check-prompt";
import { VideoPlayer } from "./video-player";

const { requestEmailVerificationActionMock, startWatchSessionActionMock } = vi.hoisted(() => ({
  requestEmailVerificationActionMock: vi.fn(),
  startWatchSessionActionMock: vi.fn(),
}));
vi.mock("next/navigation", () => ({ usePathname: () => "/watch/campaign-1" }));
vi.mock("./hls-attacher", () => ({ HlsAttacher: () => null }));
vi.mock("./identity-check-actions", () => ({
  requestEmailVerificationAction: requestEmailVerificationActionMock,
}));
vi.mock("./watch-player-actions", () => ({
  startWatchSessionAction: startWatchSessionActionMock,
  getWatchSessionAction: vi.fn(),
  reportWatchProgressAction: vi.fn(),
  completeWatchSessionAction: vi.fn(),
  presentCheckpointAction: vi.fn(),
  answerCheckpointAction: vi.fn(),
}));

beforeEach(() => {
  requestEmailVerificationActionMock.mockReset();
  startWatchSessionActionMock.mockReset();
});

describe("IdentityCheckPrompt (F126)", () => {
  it("offers only the missing steps, and the passkey step comes back to this page", () => {
    render(<IdentityCheckPrompt missing={["add_passkey"]} locale="en-AU" />);
    expect(
      screen.queryByRole("button", { name: "Send me the verification email" }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Add a passkey" })).toHaveAttribute(
      "href",
      "/passkey?returnTo=%2Fwatch%2Fcampaign-1",
    );
  });

  it("sends the verification email and says where to look", async () => {
    requestEmailVerificationActionMock.mockResolvedValue({ ok: true, data: { requested: true } });
    render(<IdentityCheckPrompt missing={["verify_email", "add_passkey"]} locale="en-AU" />);
    fireEvent.click(screen.getByRole("button", { name: "Send me the verification email" }));
    expect(
      await screen.findByText(/Check your inbox and open the link, then come back to earn points/),
    ).toBeInTheDocument();
    expect(requestEmailVerificationActionMock).toHaveBeenCalledTimes(1);
    expect(
      screen.queryByRole("button", { name: "Send me the verification email" }),
    ).not.toBeInTheDocument();
  });

  it("says so when the email could not be sent, in Indonesian too", async () => {
    requestEmailVerificationActionMock.mockResolvedValue({
      ok: false,
      error: { kind: "network", message: "down" },
    });
    render(<IdentityCheckPrompt missing={["verify_email"]} locale="id-ID" />);
    fireEvent.click(screen.getByRole("button", { name: "Kirim email verifikasi" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Email tidak bisa dikirim");
  });
});

describe("the player, when the session is refused for the identity check", () => {
  const campaign = campaignSchema.parse({
    id: "11111111-1111-4111-8111-111111111111",
    kind: "long_form",
    title: "Test Campaign",
    merchantId: "22222222-2222-4222-8222-222222222222",
    merchantName: "Toko Uji",
    synopsis: "A synopsis for testing.",
    durationSeconds: 90,
    chapters: [{ title: "Full video", startSeconds: 0, rewardWeight: 1 }],
    videoSource: { kind: "hls", manifestUrl: "https://mock.yourtal.test/hls/sample.m3u8" },
    estimatedDataMb: 90,
    rewardPoints: 100,
    questionCount: 1,
    scoringRule: "base_plus_accuracy_bonus",
    status: "active",
    publishedAt: "2026-09-19T09:00:00.000Z",
    businessId: "22222222-2222-4222-8222-222222222222",
    region: "AU",
    audience: "all_ages",
    contentCategory: "food-and-drink",
    posterUrl: "https://mock.yourtal.test/poster.jpg",
    teaserUrl: "https://mock.yourtal.test/teaser.mp4",
    hlsUrl: "https://mock.yourtal.test/hls/sample.m3u8",
    captionsUrl: null,
    aspect: "16:9",
    estimatedBytes: 94_371_840,
    startsAt: "2026-09-19T09:00:00.000Z",
    endsAt: "2026-12-19T09:00:00.000Z",
  });
  const terms = campaignTermsSchema.parse({
    campaignId: campaign.id,
    version: 1,
    rewardPoints: 75,
    questionCount: 1,
    scoringRule: "base_plus_accuracy_bonus",
    durationSeconds: 90,
    accuracyBonusPoints: 25,
    effectiveFrom: "2026-09-19T09:00:00.000Z",
  });

  it("asks for the email and a passkey before any video plays, and still lets them watch", async () => {
    startWatchSessionActionMock.mockResolvedValue({
      ok: true,
      data: {
        session: {
          id: "session-1",
          nonEarning: true,
          nonEarningReason: "identity_check_required",
          questionsAsked: 0,
        },
        durationSeconds: 90,
        alreadyEarned: false,
        manifestUrl: "/media/hls/1/2/session-1/index.m3u8",
        identityCheck: { missing: ["verify_email", "add_passkey"] },
      },
    });
    render(<VideoPlayer campaign={campaign} terms={terms} locale="en-AU" />);
    fireEvent.click(screen.getByRole("button", { name: "Play Test Campaign" }));

    expect(
      await screen.findByText("Verify your email and add a passkey to start earning."),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Send me the verification email" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Add a passkey" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Watch without earning" })).toBeInTheDocument();
    expect(document.querySelector("video")?.getAttribute("src")).toBeNull();
  });
});
