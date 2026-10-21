import "@testing-library/jest-dom/vitest";
import { render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { describe, expect, it } from "vitest";
import { RegionProvider } from "@/features/region/region-context";
import enStudio from "@/messages/en-AU/studio.json";
import idStudio from "@/messages/id-ID/studio.json";
import type { TeamAuditEntry } from "./studio-audit";
import { TeamAuditTrail } from "./team-audit-trail";

// 14:30 UTC on 20 Oct is 01:30 on the 21st in Sydney and 21:30 on the 20th in Jakarta.
const entries: TeamAuditEntry[] = [
  {
    id: "e1",
    occurredAt: "2026-10-20T14:30:00.000Z",
    action: "joined",
    message: "joined",
    params: { name: "Budi" },
  },
];

function show(region: "AU" | "ID" | null, locale: "en-AU" | "id-ID" = "en-AU") {
  const trail = <TeamAuditTrail entries={entries} />;
  return render(
    <NextIntlClientProvider
      locale={locale}
      messages={{ studio: locale === "en-AU" ? enStudio : idStudio }}
    >
      {region === null ? trail : <RegionProvider region={region}>{trail}</RegionProvider>}
    </NextIntlClientProvider>,
  );
}

describe("TeamAuditTrail", () => {
  it("writes an entry's time in the business's region zone", () => {
    show("AU");
    expect(screen.getByText("21 Oct 2026, 1:30 am")).toBeInTheDocument();
  });

  it("uses Jakarta for an Indonesian business, in the viewer's language", () => {
    show("ID", "id-ID");
    expect(screen.getByText("20 Okt 2026, 21.30")).toBeInTheDocument();
  });

  it("falls back to UTC when no region is provided, never the machine's zone", () => {
    show(null);
    expect(screen.getByText("20 Oct 2026, 2:30 pm")).toBeInTheDocument();
  });
});
