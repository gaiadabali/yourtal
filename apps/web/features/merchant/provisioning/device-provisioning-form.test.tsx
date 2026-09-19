import "@testing-library/jest-dom/vitest";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { DeviceProvisioningForm } from "./device-provisioning-form";

/**
 * Rendering-only, per this file's neighbours (`device-session-cookie.ts`
 * etc.): the form's `action` is a real `"use server"` export
 * (`submitProvisioningCode`), and calling it outside a real Next.js
 * request would hit `next/headers` with no request context. These tests
 * never submit the form — they assert the rendered fields, labels and
 * error copy, which is the actual logic this component owns (the rest is
 * a plain `<form>`).
 */
describe("DeviceProvisioningForm", () => {
  it("renders the code and PIN fields with accessible, bilingual labels", () => {
    render(<DeviceProvisioningForm />);
    expect(screen.getByLabelText(/Provisioning code/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/Choose a 4–6 digit PIN/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/Confirm PIN/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Pair this device/i })).toBeInTheDocument();
  });

  it("shows no error banner when no error is present", () => {
    render(<DeviceProvisioningForm />);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("shows the invalid-code message for an unrecognised provisioning code", () => {
    render(<DeviceProvisioningForm error="invalid_code" />);
    expect(screen.getByRole("alert")).toHaveTextContent(/wasn't recognised/i);
  });

  it("shows the PIN-mismatch message when the two PINs disagree", () => {
    render(<DeviceProvisioningForm error="pin_mismatch" />);
    expect(screen.getByRole("alert")).toHaveTextContent(/don't match/i);
  });

  it("shows the PIN-format message for a malformed PIN", () => {
    render(<DeviceProvisioningForm error="pin_invalid" />);
    expect(screen.getByRole("alert")).toHaveTextContent(/4–6 digits/i);
  });

  it("ignores an unrecognised error code rather than rendering a blank alert", () => {
    render(<DeviceProvisioningForm error="something_unexpected" />);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});
