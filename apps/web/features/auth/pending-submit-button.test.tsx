import "@testing-library/jest-dom/vitest";
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import type * as ReactDom from "react-dom";

const status = vi.hoisted(() => ({ pending: false }));
vi.mock("react-dom", async (importOriginal) => ({
  ...(await importOriginal<typeof ReactDom>()),
  useFormStatus: () => status,
}));

import { PendingSubmitButton } from "./pending-submit-button";

describe("PendingSubmitButton", () => {
  it("is enabled while the form is idle", () => {
    status.pending = false;
    render(<PendingSubmitButton>Join</PendingSubmitButton>);
    expect(screen.getByRole("button", { name: "Join" })).toBeEnabled();
  });

  it("is disabled while the form is submitting, so a double tap sends once", () => {
    status.pending = true;
    render(<PendingSubmitButton>Join</PendingSubmitButton>);
    expect(screen.getByRole("button", { name: "Join" })).toBeDisabled();
  });
});
