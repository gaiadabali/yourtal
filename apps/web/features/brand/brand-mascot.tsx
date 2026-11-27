import { useTranslations } from "next-intl";
import { Mascot, type MascotProps } from "@yourtal/ui/brand/mascot";

export interface BrandMascotProps extends Omit<MascotProps, "label"> {
  /** Hide it from assistive technology when the text beside it already says everything. */
  decorative?: boolean;
}

/**
 * The YourTal mascot with its name in the viewer's language (`brand.mascotAlt`,
 * en-AU and id-ID). It stands where the mascot carries a moment of its own: a
 * finished redemption, the end of onboarding. Next to a heading that already
 * explains the screen (empty states, sign-in), use `decorative`.
 */
export function BrandMascot({ decorative = false, ...props }: BrandMascotProps) {
  const t = useTranslations("brand");
  return <Mascot {...props} {...(decorative ? {} : { label: t("mascotAlt") })} />;
}
