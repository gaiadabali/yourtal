import "@testing-library/jest-dom/vitest";
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { EarnMoment } from "./earn-moment";

// 14:00 UTC is 01:00 on 1 Jan in Sydney but 21:00 on 31 Dec in Jakarta.
const UNLOCK_AT = "2026-12-31T14:00:00.000Z";

describe("EarnMoment unlock date", () => {
  it("is the Australian day for en-AU, whatever zone the server runs in", () => {
    render(<EarnMoment points={3} unlockAt={UNLOCK_AT} locale="en-AU" />);
    expect(screen.getByText(/1 Jan 2027/)).toBeInTheDocument();
  });

  it("is the Indonesian day for id-ID", () => {
    render(<EarnMoment points={3} unlockAt={UNLOCK_AT} locale="id-ID" />);
    expect(screen.getByText(/31 Des 2026/)).toBeInTheDocument();
  });
});
