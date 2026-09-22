import "@testing-library/jest-dom/vitest";
import type { ReactElement } from "react";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { NextIntlClientProvider } from "next-intl";
import type { Region } from "@yourtal/contracts/region";
import { RegionProvider } from "@/features/region/region-context";
import { regionDisplayConfig } from "@/features/region/region-config";
import enAU from "@/messages/en-AU/checkpoint.json";
import idID from "@/messages/id-ID/checkpoint.json";
import { CheckpointResult } from "./checkpoint-result";
import {
  makeCampaignFixture,
  multipleChoiceFixture,
  trueFalseFixture,
} from "./checkpoint-question-fixtures";
import type { QuestionAnswer } from "./checkpoint-types";
import { toPoints } from "@yourtal/contracts/money";

const questions = [multipleChoiceFixture, trueFalseFixture];

/** `CheckpointResult` is a Client Component that reads the region and its translations ambiently (YT-0405) — see `burn-error-message.test.tsx` for the same pattern. */
function renderWithRegion(ui: ReactElement, region: Region = "ID") {
  const { locale } = regionDisplayConfig(region);
  const messages = { checkpoint: region === "AU" ? enAU : idID };
  return render(
    <NextIntlClientProvider locale={locale} messages={messages}>
      <RegionProvider region={region}>{ui}</RegionProvider>
    </NextIntlClientProvider>,
  );
}

describe("CheckpointResult", () => {
  it("shows base reward and accuracy bonus as two separate, distinctly labelled figures", () => {
    const campaign = makeCampaignFixture({ rewardPoints: toPoints(1000) });
    const answers = new Map<string, QuestionAnswer>([
      [
        multipleChoiceFixture.id,
        { type: "multiple_choice", selectedOptionId: multipleChoiceFixture.correctOptionId },
      ],
      [trueFalseFixture.id, { type: "true_false", value: !trueFalseFixture.correctAnswer }],
    ]);
    renderWithRegion(
      <CheckpointResult campaign={campaign} questions={questions} answers={answers} />,
    );

    expect(screen.getByText("Reward dasar")).toBeInTheDocument();
    expect(screen.getByText(/Dijamin/)).toBeInTheDocument();
    expect(screen.getByText("Bonus akurasi")).toBeInTheDocument();

    // Base (600) and bonus (200 at 50% accuracy) render as distinct figures — never one combined number only.
    expect(screen.getByText("600 poin")).toBeInTheDocument();
    expect(screen.getByText("200 poin")).toBeInTheDocument();
    expect(screen.getByText("800 poin")).toBeInTheDocument();
  });

  it("states plainly when a campaign has no accuracy bonus, rather than omitting the section silently", () => {
    const campaign = makeCampaignFixture({ scoringRule: "base_only", rewardPoints: toPoints(500) });
    renderWithRegion(
      <CheckpointResult campaign={campaign} questions={questions} answers={new Map()} />,
    );

    expect(screen.getByText("Reward dasar")).toBeInTheDocument();
    expect(screen.getByText(/tidak memiliki bonus akurasi/)).toBeInTheDocument();
    expect(screen.queryByText("Bonus akurasi")).not.toBeInTheDocument();
  });
});

describe("CheckpointResult (en-AU, YT-0405)", () => {
  it("shows base reward and accuracy bonus in English, with no Indonesian copy leaking through", () => {
    const campaign = makeCampaignFixture({ rewardPoints: toPoints(1000) });
    const answers = new Map<string, QuestionAnswer>([
      [
        multipleChoiceFixture.id,
        { type: "multiple_choice", selectedOptionId: multipleChoiceFixture.correctOptionId },
      ],
      [trueFalseFixture.id, { type: "true_false", value: !trueFalseFixture.correctAnswer }],
    ]);
    const { container } = renderWithRegion(
      <CheckpointResult campaign={campaign} questions={questions} answers={answers} />,
      "AU",
    );

    expect(screen.getByText("Base reward")).toBeInTheDocument();
    expect(screen.getByText(/Guaranteed/)).toBeInTheDocument();
    expect(screen.getByText("Accuracy bonus")).toBeInTheDocument();
    expect(screen.getByText("600 points")).toBeInTheDocument();
    expect(screen.getByText(/50% accuracy/)).toBeInTheDocument();
    expect(container.textContent).not.toMatch(/\bpoin\b|Dijamin|akurasi|diterima/i);
  });

  it("states plainly in English when a campaign has no accuracy bonus", () => {
    const campaign = makeCampaignFixture({ scoringRule: "base_only", rewardPoints: toPoints(500) });
    renderWithRegion(
      <CheckpointResult campaign={campaign} questions={questions} answers={new Map()} />,
      "AU",
    );

    expect(screen.getByText(/has no accuracy bonus/)).toBeInTheDocument();
    expect(screen.getByText("Total you should receive")).toBeInTheDocument();
  });

  /**
   * YT-0564. The assertion this replaces was `getByText("Total received")`,
   * and it passed for as long as the screen made a false claim: under O-1
   * nothing is granted until full playback AND answered questions, and the
   * server's `complete` refuses every completion today, so the figure was
   * certainly unreceived at the moment it rendered.
   *
   * Asserting the replacement string alone would repeat that mistake in the
   * other direction — it would pin today's wording without pinning what the
   * wording has to MEAN. So this asserts the property: the screen states an
   * expectation, says the points are not in the balance yet, and never
   * claims receipt. Reintroducing "received" fails it whatever the key is
   * called.
   */
  it.each([
    ["AU" as const, "Total you should receive", /Not yet in your balance/i, /received/i],
    ["ID" as const, "Total yang akan kamu terima", /Belum masuk ke saldomu/i, /diterima/i],
  ])(
    "promises the reward rather than reporting it as received (%s)",
    (region, expectedLabel, pendingNote, receiptClaim) => {
      const campaign = makeCampaignFixture({ rewardPoints: toPoints(500) });
      renderWithRegion(
        <CheckpointResult campaign={campaign} questions={questions} answers={new Map()} />,
        region,
      );

      expect(screen.getByText(expectedLabel)).toBeInTheDocument();
      expect(screen.getByText(pendingNote)).toBeInTheDocument();
      expect(screen.queryByText(receiptClaim)).not.toBeInTheDocument();
    },
  );
});
