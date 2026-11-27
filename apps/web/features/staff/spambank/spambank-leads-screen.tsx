import Link from "next/link";
import type { Route } from "next";
import { getTranslations } from "next-intl/server";
import { Button } from "@yourtal/ui/button";
import { Input } from "@yourtal/ui/input";
import { NativeSelect } from "@yourtal/ui/native-select";
import { Notice } from "@yourtal/ui/notice";
import { PageHeader } from "@yourtal/ui/page-header";
import { Text } from "@yourtal/ui/text";
import type { StaffSession } from "@yourtal/contracts/staff/session";
import { listSpambankLeads, leadQueryString, type LeadQuery } from "./spambank-staff-data";
import { LEAD_STATUSES } from "./spambank-staff-contract";
import { SpambankLeadsList } from "./spambank-leads-list";

export interface SpambankLeadsScreenProps {
  readonly session: StaffSession;
  readonly query: LeadQuery;
}

/**
 * `/staff/spambank/leads` (BUILD.md 4.7): the brands mailing Spambank users in
 * the staff member's own region, for GOD's sales team. Search and the status
 * filter are a plain GET form; the CSV export keeps the same filters.
 */
export async function SpambankLeadsScreen({ session, query }: SpambankLeadsScreenProps) {
  const t = await getTranslations("staff.spambank.leads");
  const page = await listSpambankLeads(query);
  const exportQuery = leadQueryString({
    ...(query.status === undefined ? {} : { status: query.status }),
    ...(query.q === undefined ? {} : { q: query.q }),
  });

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title={t("title")} description={t("intro")} />
      <form method="get" className="flex flex-wrap items-end gap-3">
        <Input
          label={t("searchLabel")}
          name="q"
          type="search"
          defaultValue={query.q ?? ""}
          className="max-w-xs"
        />
        <NativeSelect
          name="status"
          label={t("statusFilterLabel")}
          defaultValue={query.status ?? ""}
          className="w-44"
        >
          <option value="">{t("statusAll")}</option>
          {LEAD_STATUSES.map((value) => (
            <option key={value} value={value}>
              {t(`status.${value}`)}
            </option>
          ))}
        </NativeSelect>
        <Button type="submit" variant="secondary">
          {t("searchSubmit")}
        </Button>
        <a
          href={`/staff/spambank/leads/export${exportQuery}`}
          className="inline-flex h-control items-center rounded-control border border-border-control px-4 text-label font-sans text-fg hover:bg-surface-sunken"
        >
          {t("exportCsv")}
        </a>
      </form>
      {page === null ? (
        <Notice tone="warning">{t("unavailable")}</Notice>
      ) : (
        <>
          <Text tone="muted" size="caption">
            {t("regionNote", { region: t(`regionName.${session.region}`) })}
          </Text>
          <SpambankLeadsList
            key={`${query.status ?? ""}|${query.q ?? ""}|${query.cursor ?? ""}`}
            initial={page.items}
            region={session.region}
            canEdit={session.roles.includes("ops")}
          />
          {page.nextCursor === null ? null : (
            <Link
              href={
                `/staff/spambank/leads${leadQueryString({ ...query, cursor: page.nextCursor })}` as Route
              }
              className="text-label font-sans text-accent underline"
            >
              {t("nextPage")}
            </Link>
          )}
        </>
      )}
    </div>
  );
}
