import "@testing-library/jest-dom/vitest";
import * as React from "react";
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { StatusBadge } from "./status-badge";

describe("StatusBadge", () => {
  it("renders the caller-supplied label", () => {
    render(<StatusBadge status="success">Verified</StatusBadge>);
    expect(screen.getByText("Verified")).toBeInTheDocument();
  });

  it("supports every status in both emphases", () => {
    const statuses = ["success", "warning", "danger", "info", "neutral"] as const;
    for (const status of statuses) {
      for (const emphasis of ["subtle", "solid"] as const) {
        const { unmount } = render(
          <StatusBadge status={status} emphasis={emphasis}>
            {`${status}-${emphasis}`}
          </StatusBadge>,
        );
        expect(screen.getByText(`${status}-${emphasis}`)).toBeInTheDocument();
        unmount();
      }
    }
  });
});
