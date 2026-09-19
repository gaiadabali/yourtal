import Link from "next/link";
import { asDisplayIdr, formatMoney } from "@yourtal/contracts/money/format";
import { Button } from "@yourtal/ui/button";
import { regionDisplayConfig } from "@/features/region/region-config";
import { getOnboardingCopy } from "@/features/onboarding/onboarding-copy";
import { OnboardingProgress } from "@/features/onboarding/onboarding-progress";
import { requireRegionParam } from "@/features/onboarding/onboarding-region-param";

export interface OnboardingDonePageProps {
  params: Promise<{ region: string }>;
}

/**
 * A made-up, clearly-labelled illustration, matching `region-picker.tsx`'s
 * "Example reward" — never a real quote (docs/03-regulatory-and-risk.md
 * section 3.3b, the Scoopon precedent on unevidenced reward/breakage
 * claims).
 */
const EXAMPLE_REWARD_MINOR: Record<"AUD" | "IDR", number> = { AUD: 1250, IDR: 45_000 };

/**
 * `/onboarding/[region]/done` — completion (YT-0430). Confirms the region
 * choice's downstream effect concretely: the country name and an example
 * price run through the real `formatMoney(amountMinor, currency)`, so a
 * reader can see AU renders AUD and ID renders IDR from the same call site,
 * not just read a claim that it does. Server Component throughout; the one
 * action is a plain `<Link>` into the app.
 */
export default async function OnboardingDonePage({ params }: OnboardingDonePageProps) {
  const { region: rawRegion } = await params;
  const region = requireRegionParam(rawRegion);
  const config = regionDisplayConfig(region);
  const copy = getOnboardingCopy(config.locale).done;
  const exampleReward = formatMoney(
    asDisplayIdr(EXAMPLE_REWARD_MINOR[config.currency]),
    config.currency,
  );

  return (
    <div className="flex flex-col gap-6">
      <OnboardingProgress current={4} total={4} region={region} />
      <div className="flex flex-col gap-3 text-center">
        <h1 className="text-2xl font-sans font-semibold text-fg">{copy.heading}</h1>
        <p className="text-sm font-sans text-fg-muted">
          {copy.bodyIntro} <strong className="text-fg">{config.countryName}</strong>.
        </p>
        <p className="text-sm font-sans text-fg-muted">
          {copy.currencyPrefix} {config.currency}.
        </p>
        <p className="text-xs font-sans text-fg-subtle">
          {copy.exampleRewardLabel}: {exampleReward}
        </p>
      </div>
      <Button asChild>
        <Link href="/">{copy.cta}</Link>
      </Button>
    </div>
  );
}
