import { getFormatter, getTranslations } from "next-intl/server";
import { DataTable } from "@yourtal/ui/data-table";
import { KeyValue } from "@yourtal/ui/key-value";
import { Notice } from "@yourtal/ui/notice";
import { PageHeader } from "@yourtal/ui/page-header";
import { Heading } from "@yourtal/ui/heading";
import { StatusBadge } from "@yourtal/ui/status-badge";
import { Text } from "@yourtal/ui/text";
import type { StaffSession } from "@yourtal/contracts/staff/session";
import { formatStaffTime } from "../staff-time";
import { getSpambankAutoreply } from "./spambank-staff-data";
import { SpambankAutoreplyControls } from "./spambank-autoreply-controls";
import type { BlocklistCheck } from "./spambank-staff-contract";

const MODE_TONE = {
  off: "neutral",
  dry_run: "info",
  redirect: "warning",
  live: "success",
} as const;
const RESULT_TONE = {
  clean: "success",
  listed: "danger",
  refused: "warning",
  error: "warning",
} as const;

/**
 * `/staff/spambank/autoreply` (BUILD.md 4.6/5.4): whether the counter-spam
 * auto-reply is running, why it paused, today's numbers and the last blocklist
 * checks, with the kill switch, resume and daily cap for `ops` and `admin`.
 */
export async function SpambankAutoreplyScreen({ session }: { readonly session: StaffSession }) {
  const t = await getTranslations("staff.spambank.autoreply");
  const format = await getFormatter();
  const state = await getSpambankAutoreply();
  const region = session.region;

  if (state === null) {
    return (
      <div className="flex flex-col gap-6">
        <PageHeader title={t("title")} description={t("intro")} />
        <Notice tone="warning">{t("unavailable")}</Notice>
      </div>
    );
  }

  const paused = state.pausedAt !== null;
  const blocklistColumns = [
    { key: "target", header: t("columnTarget"), cell: (row: BlocklistCheck) => row.target },
    { key: "list", header: t("columnList"), cell: (row: BlocklistCheck) => row.list },
    {
      key: "result",
      header: t("columnResult"),
      cell: (row: BlocklistCheck) => (
        <StatusBadge status={RESULT_TONE[row.result]}>{t(`result.${row.result}`)}</StatusBadge>
      ),
    },
    {
      key: "checkedAt",
      header: t("columnChecked"),
      cell: (row: BlocklistCheck) => formatStaffTime(format, row.checkedAt, region),
    },
  ];

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title={t("title")} description={t("intro")} />
      {paused ? (
        <Notice tone="danger" title={t("pausedTitle")}>
          {t("pausedBody", {
            when: formatStaffTime(format, state.pausedAt ?? "", region),
            reason: state.pausedReason ?? t("pausedNoReason"),
          })}
        </Notice>
      ) : null}
      {state.tripped ? (
        <Notice tone="warning" title={t("trippedTitle")}>
          {t("trippedBody")}
        </Notice>
      ) : null}
      <section aria-labelledby="sb-status" className="flex flex-col gap-3">
        <Heading id="sb-status" level={2} size="title">
          {t("statusHeading")}
        </Heading>
        <KeyValue
          className="max-w-xl"
          items={[
            {
              key: "mode",
              label: t("mode"),
              value: (
                <StatusBadge status={MODE_TONE[state.mode]}>{t(`modes.${state.mode}`)}</StatusBadge>
              ),
            },
            {
              key: "tripped",
              label: t("switch"),
              value: state.tripped ? t("switchTripped") : t("switchRunning"),
            },
            { key: "cap", label: t("dailyCap"), value: state.dailyCap },
            { key: "sent", label: t("sentToday"), value: state.today.sent },
            { key: "bounces", label: t("bouncesToday"), value: state.today.bounces },
            { key: "complaints", label: t("complaintsToday"), value: state.today.complaints },
          ]}
        />
        <Text size="caption" tone="muted">
          {t("todayNote")}
        </Text>
      </section>
      <section aria-labelledby="sb-controls" className="flex flex-col gap-3">
        <Heading id="sb-controls" level={2} size="title">
          {t("controlsHeading")}
        </Heading>
        <SpambankAutoreplyControls
          tripped={state.tripped}
          paused={paused}
          dailyCap={state.dailyCap}
        />
      </section>
      <section aria-labelledby="sb-blocklist" className="flex flex-col gap-3">
        <Heading id="sb-blocklist" level={2} size="title">
          {t("blocklistHeading")}
        </Heading>
        {state.lastBlocklist.length === 0 ? (
          <Text tone="muted">{t("blocklistEmpty")}</Text>
        ) : (
          <DataTable
            caption={t("blocklistCaption")}
            rows={[...state.lastBlocklist]}
            getRowKey={(row) => `${row.target}|${row.list}|${row.checkedAt}`}
            columns={blocklistColumns}
          />
        )}
      </section>
    </div>
  );
}
