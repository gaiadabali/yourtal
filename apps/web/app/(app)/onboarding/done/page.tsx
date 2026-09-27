import Link from "next/link";
import type { Route } from "next";
import { getTranslations } from "next-intl/server";
import { Heading } from "@yourtal/ui/heading";
import { Text } from "@yourtal/ui/text";
import { Button } from "@yourtal/ui/button";
import { OnboardingProgress } from "@/features/onboarding/onboarding-progress";
import { ONBOARDING_STEPS, onboardingStepIndex } from "@/features/onboarding/onboarding-steps";
import { OnboardingTimingMark } from "@/features/onboarding/onboarding-timing-mark";
import { parseReturnTo } from "@/features/onboarding/onboarding-return-to";

export interface OnboardingDonePageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

/**
 * `/onboarding/done` — completion (6.2.b). No made-up example reward here
 * (the old `region-picker.tsx`-era illustration this replaced was deleted
 * along with region-picker itself; region is chosen at register now, and
 * this step never needed the figure to explain a region choice it no
 * longer makes). `returnTo` (already validated by `parseReturnTo`, ULTIMATELY
 * from a URL a browser sent) is where 6.2.c's Check lands: Home by default,
 * or exactly where an anonymous, rewarded Open Viewing session would have
 * been paid, once it exists (YT-0432).
 */
export default async function OnboardingDonePage({ searchParams }: OnboardingDonePageProps) {
  const t = await getTranslations("onboarding.done");
  const returnTo = parseReturnTo((await searchParams).returnTo);
  const ctaHref = (returnTo ?? "/") as Route;

  return (
    <div className="flex flex-col gap-6">
      <OnboardingTimingMark mark="signup-complete" />
      <OnboardingProgress steps={ONBOARDING_STEPS} currentIndex={onboardingStepIndex("done")} />
      <div className="flex flex-col gap-3 text-center">
        <Heading level={1} size="headline">
          {t("heading")}
        </Heading>
        <Text tone="muted">{t("body")}</Text>
      </div>
      <Button asChild>
        <Link href={ctaHref}>{t("cta")}</Link>
      </Button>
    </div>
  );
}
