"use client";

import * as React from "react";
import { ChevronRight } from "lucide-react";
import { Button } from "@yourtal/ui/button";
import { ChannelAvatar } from "@yourtal/ui/channel-avatar";
import { Chip } from "@yourtal/ui/chip";
import type { DataTableColumn } from "@yourtal/ui/data-table";
import { DataTable } from "@yourtal/ui/data-table";
import { FilterBar } from "@yourtal/ui/filter-bar";
import { KeyValue } from "@yourtal/ui/key-value";
import { ListRow } from "@yourtal/ui/list-row";
import { StatusBadge } from "@yourtal/ui/status-badge";
import { GalleryRow, GallerySection } from "../lib/gallery-section";

interface Redemption {
  id: string;
  reward: string;
  points: string;
  status: "success" | "warning" | "danger";
  statusLabel: string;
  date: string;
}

const REDEMPTIONS: Redemption[] = [
  {
    id: "r1",
    reward: "Coffee voucher",
    points: "500",
    status: "success",
    statusLabel: "Delivered",
    date: "12 Sep",
  },
  {
    id: "r2",
    reward: "Movie ticket",
    points: "800",
    status: "warning",
    statusLabel: "Processing",
    date: "14 Sep",
  },
  {
    id: "r3",
    reward: "Data pack 5GB",
    points: "300",
    status: "danger",
    statusLabel: "Failed",
    date: "15 Sep",
  },
];

const COLUMNS: DataTableColumn<Redemption>[] = [
  { key: "reward", header: "Reward", cell: (row) => row.reward },
  { key: "points", header: "Points", cell: (row) => row.points, align: "end" },
  {
    key: "status",
    header: "Status",
    cell: (row) => (
      <StatusBadge status={row.status} emphasis="subtle">
        {row.statusLabel}
      </StatusBadge>
    ),
  },
  { key: "date", header: "Date", cell: (row) => row.date, align: "end" },
];

const CATEGORIES = ["Beauty", "Tech", "Food"] as const;

/** KeyValue, DataTable, ListRow and FilterBar — list and summary primitives. */
export function DataDisplayGroup() {
  const [active, setActive] = React.useState<string>("Tech");

  return (
    <>
      <GallerySection
        id="key-value"
        title="KeyValue"
        description="Inline and stacked label/value rows."
      >
        <GalleryRow label="Inline">
          <KeyValue
            className="w-72"
            items={[
              { key: "plan", label: "Plan", value: "Free" },
              { key: "region", label: "Region", value: "Australia" },
              { key: "points", label: "Points balance", value: "1,240" },
            ]}
          />
        </GalleryRow>
        <GalleryRow label="Stacked">
          <KeyValue
            layout="stacked"
            className="w-72"
            items={[
              { key: "address", label: "Delivery address", value: "123 Example St, Sydney NSW" },
            ]}
          />
        </GalleryRow>
      </GallerySection>

      <GallerySection
        id="data-table"
        title="DataTable"
        description="A real table from md up, stacked cards below it."
      >
        <DataTable
          caption="Recent redemptions"
          columns={COLUMNS}
          rows={REDEMPTIONS}
          getRowKey={(row) => row.id}
        />
      </GallerySection>

      <GallerySection
        id="list-row"
        title="ListRow"
        description="Static, link and button targets, all at a 44 px minimum height."
      >
        <div className="flex w-full max-w-md flex-col gap-1 rounded-card border border-border-subtle bg-surface p-1">
          <ListRow
            leading={<ChannelAvatar name="Bumi Coffee" size="sm" />}
            title="Bumi Coffee"
            subtitle="Static row — no target"
            trailing={
              <StatusBadge status="success" emphasis="subtle">
                Active
              </StatusBadge>
            }
          />
          <ListRow
            href="#wallet"
            leading={<ChannelAvatar name="Wallet" size="sm" />}
            title="View your wallet"
            subtitle="Link row"
            trailing={<ChevronRight className="size-4 text-fg-subtle" aria-hidden="true" />}
          />
          <ListRow
            onClick={() => undefined}
            leading={<ChannelAvatar name="Settings" size="sm" />}
            title="Notification settings"
            subtitle="Button row"
            trailing={<ChevronRight className="size-4 text-fg-subtle" aria-hidden="true" />}
          />
        </div>
      </GallerySection>

      <GallerySection
        id="filter-bar"
        title="FilterBar"
        description="A row of filter chips with a clear action."
      >
        <FilterBar
          clearAction={
            <Button variant="ghost" size="sm">
              Clear filters
            </Button>
          }
        >
          {CATEGORIES.map((category) => (
            <Chip
              key={category}
              pressed={active === category}
              onPressedChange={(pressed) => {
                setActive(pressed ? category : "");
              }}
            >
              {category}
            </Chip>
          ))}
          <Chip variant="static">3 videos match</Chip>
        </FilterBar>
      </GallerySection>
    </>
  );
}
