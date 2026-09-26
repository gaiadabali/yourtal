"use client";

import { useTranslations } from "next-intl";
import { Section } from "@yourtal/ui/section";
import { Button } from "@yourtal/ui/button";
import { Text } from "@yourtal/ui/text";
import { fetchDataExportAction } from "./me-actions";
import { useMeActionStatus } from "./use-me-action-status";

/**
 * `GET /api/me/data-export` (5.4.b). Fetched through the Server Action
 * (server-only `apiFetch`, per `me-data.ts`'s own doc comment) and handed
 * to the browser as a downloaded file from here — the one place in this
 * feature that needs `URL.createObjectURL`, since a Server Action cannot
 * hand back a file the browser saves directly.
 */
export function MeDataExportSection() {
  const t = useTranslations("me.dataExport");
  const { status, isPending, run } = useMeActionStatus();

  function handleDownload() {
    run(
      () => fetchDataExportAction(),
      (data) => {
        const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
        const url = URL.createObjectURL(blob);
        const anchor = document.createElement("a");
        anchor.href = url;
        anchor.download = `yourtal-data-export-${data.generatedAt.slice(0, 10)}.json`;
        anchor.click();
        URL.revokeObjectURL(url);
      },
    );
  }

  return (
    <Section title={t("heading")} description={t("intro")}>
      <Button
        type="button"
        variant="secondary"
        onClick={handleDownload}
        disabled={isPending}
        className="self-start"
      >
        {t("downloadCta")}
      </Button>
      {status.kind === "error" ? (
        <Text size="body-sm" tone="danger" role="alert">
          {status.message}
        </Text>
      ) : null}
    </Section>
  );
}
