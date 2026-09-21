import { Progress } from "@yourtal/ui/progress";
import { getCheckpointTranslator, type SupportedLocale } from "./checkpoint-i18n";

export interface CheckpointProgressProps {
  current: number;
  total: number;
  locale: SupportedLocale;
}

/**
 * "Conversational" progress for the checkpoint flow (docs/tasks/phase-u-ui.md
 * YT-0413): one question at a time with a visible sense of where the
 * respondent is, not a dense form. The text label and the progress bar
 * carry the same information; the bar's `aria-label` repeats the label so
 * a screen reader gets it from either the label paragraph or the widget
 * itself, whichever it lands on first.
 *
 * YT-0405: `locale` is required, not defaulted — this is a Server
 * Component reached from `checkpoint-question-step.tsx` (a Client
 * Component), which reads the real region via `useRegion()` and passes it
 * straight through, so there is no silent id-ID fallback here.
 */
export function CheckpointProgress({ current, total, locale }: CheckpointProgressProps) {
  const t = getCheckpointTranslator(locale);
  const label = t("progress.label", { current, total });
  return (
    <div className="flex flex-col gap-1.5">
      <p className="text-xs font-sans font-medium text-fg-muted">{label}</p>
      <Progress value={current} max={total} aria-label={label} />
    </div>
  );
}
