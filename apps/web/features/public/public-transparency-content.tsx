import type { ProvedDay } from "@yourtal/contracts/ledger-internal/proof";
import { Card, CardContent } from "@yourtal/ui/card";
import { DataTable } from "@yourtal/ui/data-table";
import { getPublicTranslator } from "./public-i18n";
import type { PublicLocaleConfig } from "./public-locale";

export interface PublicTransparencyContentProps {
  roots: readonly ProvedDay[];
  locale: PublicLocaleConfig;
}

/**
 * 11.3.c: every day's published Merkle root, verbatim from
 * `GET /api/proof/roots` (10.3.b) — the same root the API returns, not a
 * re-derived or reformatted one, so anyone recomputing a day's root
 * against their own copy of that day's entries can compare it directly
 * against what is printed here.
 */
export function PublicTransparencyContent({ roots, locale }: PublicTransparencyContentProps) {
  const t = getPublicTranslator(locale.intlLocale);

  if (roots.length === 0) {
    return (
      <Card>
        <CardContent className="p-6">
          <p className="text-sm text-fg-muted">{t("transparency.empty")}</p>
        </CardContent>
      </Card>
    );
  }

  const sorted = [...roots].sort((a, b) => b.date.localeCompare(a.date));

  return (
    <Card>
      <CardContent className="p-6">
        <DataTable
          caption={t("transparency.tableCaption")}
          getRowKey={(day) => day.date}
          rows={sorted}
          columns={[
            { key: "date", header: t("transparency.dateHeader"), cell: (day) => day.date },
            {
              key: "root",
              header: t("transparency.rootHeader"),
              cell: (day) => (
                <span className="font-mono text-xs break-all" title={day.merkleRoot}>
                  {day.merkleRoot}
                </span>
              ),
            },
            {
              key: "entryCount",
              header: t("transparency.entryCountHeader"),
              cell: (day) => day.entryCount,
              align: "end",
            },
          ]}
        />
      </CardContent>
    </Card>
  );
}
