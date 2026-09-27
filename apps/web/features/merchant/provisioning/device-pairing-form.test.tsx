import "@testing-library/jest-dom/vitest";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { DevicePairingForm } from "./device-pairing-form";

/**
 * Rendering-only, per this file's neighbours: the form's `action` is a
 * real `"use server"` export (`submitPairingCode`), and calling it outside
 * a real Next.js request would hit `next/headers` with no request
 * context. These tests never submit the form — they assert the rendered
 * field, label and error copy.
 */
describe("DevicePairingForm", () => {
  it("renders the pairing code field with an accessible label", () => {
    render(<DevicePairingForm />);
    expect(screen.getByLabelText(/Pairing code/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Pair this device/i })).toBeInTheDocument();
  });

  it("shows no error banner when no error is present", () => {
    render(<DevicePairingForm />);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("shows the invalid-code message for an unrecognised pairing code", () => {
    render(<DevicePairingForm error="invalid_code" />);
    expect(screen.getByRole("alert")).toHaveTextContent(/wasn't recognised/i);
  });

  it("shows the revoked message when the Admin has revoked this device", () => {
    render(<DevicePairingForm error="revoked" />);
    expect(screen.getByRole("alert")).toHaveTextContent(/revoked/i);
  });

  it("ignores an unrecognised error code rather than rendering a blank alert", () => {
    render(<DevicePairingForm error="something_unexpected" />);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});
