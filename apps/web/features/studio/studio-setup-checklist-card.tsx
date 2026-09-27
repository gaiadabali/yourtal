import { Check } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@yourtal/ui/card";
import { ListRow } from "@yourtal/ui/list-row";
import { getStudioTranslator, type SupportedLocale } from "./studio-i18n";
import type { StudioSetupStep } from "./studio-setup-checklist";

export interface StudioSetupChecklistCardProps {
  steps: readonly StudioSetupStep[];
  locale: SupportedLocale;
}

/** The overview's empty state (task 7.8.b): channel → buy points → upload → questions → submit, each a link to where it happens. */
export function StudioSetupChecklistCard({ steps, locale }: StudioSetupChecklistCardProps) {
  const t = getStudioTranslator(locale);
  const doneCount = steps.filter((step) => step.done).length;

  return (
    <Card>
      <CardHeader>
        <CardTitle as="h2">{t("chrome.checklist.title")}</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-1">
        <p className="pb-2 text-body-sm text-fg-muted">
          {t("chrome.checklist.progress", { doneCount, total: steps.length })}
        </p>
        <ul className="flex flex-col gap-1">
          {steps.map((step) => (
            <li key={step.id}>
              <ListRow
                href={step.href}
                title={step.label}
                leading={
                  <span
                    className={
                      step.done
                        ? "flex h-6 w-6 items-center justify-center rounded-pill bg-accent text-fg-on-accent"
                        : "flex h-6 w-6 items-center justify-center rounded-pill border border-border-subtle"
                    }
                  >
                    {step.done ? <Check className="h-3.5 w-3.5" aria-hidden="true" /> : null}
                  </span>
                }
              />
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}
