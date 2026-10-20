"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import type { AreaSummary } from "@yourtal/contracts/areas/schema";
import { Button } from "@yourtal/ui/button";
import { Section } from "@yourtal/ui/section";
import { Text } from "@yourtal/ui/text";
import { AreaPicker } from "@/features/areas/area-picker";
import { areaSummaryLabel } from "@/features/areas/area-label";
import { clearAreaAction, setAreaAction } from "./me-actions";
import { useMeActionStatus } from "./use-me-action-status";

export interface MeAreaSectionProps {
  initialArea: AreaSummary | null;
}

/**
 * F116: "My area", optional and for adults only (the page never renders it for
 * a teen, and the API refuses one). The person picks a state, then a suburb
 * from a visible list; the app stores the postcode and never asks for one.
 * It is declared, not located: nothing is read from the device.
 */
export function MeAreaSection({ initialArea }: MeAreaSectionProps) {
  const t = useTranslations("me.area");
  const tAreas = useTranslations("areas");
  const [area, setArea] = useState<AreaSummary | null>(initialArea);
  const [picking, setPicking] = useState(false);
  const { status, isPending, run } = useMeActionStatus();

  function pick(postcode: string) {
    run(
      () => setAreaAction(postcode),
      (data) => {
        setArea(data.area);
        setPicking(false);
      },
    );
  }

  function clear() {
    run(
      () => clearAreaAction(),
      (data) => setArea(data.area),
    );
  }

  const label =
    area === null ? null : areaSummaryLabel(area, (count) => tAreas("andMore", { count }));

  return (
    <Section title={t("heading")} description={t("intro")}>
      <Text>
        {label === null ? (
          t("none")
        ) : (
          <>
            <span className="text-fg-muted">{t("current")} </span>
            <strong className="font-semibold">{label}</strong>
            {area !== null && area.states.length > 0 ? (
              <span className="text-fg-muted"> · {area.states.join(", ")}</span>
            ) : null}
          </>
        )}
      </Text>

      {picking ? (
        <div className="flex flex-col gap-3">
          <AreaPicker onPick={(place) => pick(place.postcode)} disabled={isPending} />
          <div>
            <Button variant="ghost" size="sm" onClick={() => setPicking(false)}>
              {t("cancel")}
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" size="sm" onClick={() => setPicking(true)}>
            {area === null ? t("choose") : t("change")}
          </Button>
          {area !== null ? (
            <Button variant="ghost" size="sm" onClick={clear} loading={isPending}>
              {t("clear")}
            </Button>
          ) : null}
        </div>
      )}

      {status.kind === "success" && !picking ? (
        <Text size="body-sm" tone="muted" role="status">
          {t("saved")}
        </Text>
      ) : null}
      {status.kind === "error" ? (
        <Text size="body-sm" tone="danger" role="alert">
          {status.message}
        </Text>
      ) : null}
    </Section>
  );
}
