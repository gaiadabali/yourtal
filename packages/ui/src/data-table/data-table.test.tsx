import "@testing-library/jest-dom/vitest";
import * as React from "react";
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { DataTable } from "./data-table";
import type { DataTableColumn } from "./data-table";

interface Redemption {
  id: string;
  brand: string;
  points: number;
}

const rows: Redemption[] = [
  { id: "1", brand: "Acme Coffee", points: 120 },
  { id: "2", brand: "Bright Mart", points: 340 },
];

const columns: DataTableColumn<Redemption>[] = [
  { key: "brand", header: "Brand", cell: (row) => row.brand },
  { key: "points", header: "Points", cell: (row) => row.points, align: "end" },
];

describe("DataTable", () => {
  it("renders an accessible table with the given caption", () => {
    render(<DataTable columns={columns} rows={rows} caption="Recent redemptions" />);
    expect(screen.getByRole("table", { name: "Recent redemptions" })).toBeInTheDocument();
  });

  it("renders one column header cell per column", () => {
    render(<DataTable columns={columns} rows={rows} caption="Recent redemptions" />);
    expect(screen.getAllByRole("columnheader")).toHaveLength(2);
  });

  it("renders a row per data item, with cell content from the render fn", () => {
    render(<DataTable columns={columns} rows={rows} caption="Recent redemptions" />);
    expect(screen.getAllByText("Acme Coffee")).toHaveLength(2); // table row + card row
    expect(screen.getAllByText("Bright Mart")).toHaveLength(2);
  });

  it("renders a card list labelled with the caption for narrow viewports", () => {
    render(<DataTable columns={columns} rows={rows} caption="Recent redemptions" />);
    expect(screen.getByRole("list", { name: "Recent redemptions" })).toBeInTheDocument();
  });
});
