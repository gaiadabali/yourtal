import { getTranslations } from "next-intl/server";
import { Section } from "@yourtal/ui/section";
import { Progress } from "@yourtal/ui/progress";
import { Text } from "@yourtal/ui/text";

export interface MeTeenCapSectionProps {
  /** Today's earned points, region-day, same number the feed's own "caught up" line uses. */
  earnedTodayPoints: number;
  /** The region's `teen_daily_earn_cap` setting (F12) -- never hardcoded. */
  dailyCapPoints: number;
}

/**
 * 12.2.b: a teen-only daily-cap meter, read entirely from the server
 * (`GET /api/wallet`'s `dailyCapPoints`, `earnedToday` from wallet
 * history) -- never a client-side guess. No streak framing, no "at risk"
 * language: just today's progress toward a cap that exists to protect, not
 * to gamify.
 */
export async function MeTeenCapSection({ earnedTodayPoints, dailyCapPoints }: MeTeenCapSectionProps) {
  const t = await getTranslations("me.teenCap");
  const clamped = Math.min(earnedTodayPoints, dailyCapPoints);

  return (
    <Section title={t("heading")} description={t("intro")}>
      <div className="flex flex-col gap-2">
        <Progress
          value={clamped}
          max={dailyCapPoints}
          aria-label={t("heading")}
          className="max-w-sm"
        />
        <Text size="body-sm" tone="muted">
          {t("progress", { earned: earnedTodayPoints, cap: dailyCapPoints })}
        </Text>
      </div>
    </Section>
  );
}
