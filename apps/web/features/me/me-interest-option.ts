import {
  Car,
  Film,
  GraduationCap,
  HeartPulse,
  Home,
  Plane,
  Shirt,
  Smartphone,
  Sparkles,
  Trophy,
  UtensilsCrossed,
  Wallet,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

/**
 * The same interest catalogue `features/onboarding/interest-option.ts`
 * defines — same ids, same `labelEn`/`labelId`, same order. Duplicated
 * rather than imported (`features/onboarding/**` is this ticket's read-only
 * reference, not an importable dependency), because the brief is explicit
 * that "the same purposes must appear here with the same names, or a user
 * cannot reconcile what they agreed to with what they can change" — the
 * same reasoning applies to interests, which the brief separately calls out
 * as needing "the same vocabulary" as the onboarding picker.
 *
 * `me-interest-option-lockstep.test.ts` is the drift guard: it imports the
 * real onboarding catalogue (test code, never bundled for the browser, so
 * that import is safe here even though a component import would not be)
 * and asserts this list matches it id-for-id and label-for-label, the same
 * technique `features/region/region-config.test.ts` uses to guard its own
 * duplicated mirror of `REGION_CONFIG`.
 */
export interface MeInterestOption {
  readonly id: string;
  readonly labelEn: string;
  readonly labelId: string;
  readonly icon: LucideIcon;
  readonly tint: "primary" | "reward" | "success" | "warning" | "price";
}

export const ME_INTEREST_OPTIONS: readonly MeInterestOption[] = [
  {
    id: "food",
    labelEn: "Food & drink",
    labelId: "Makanan & minuman",
    icon: UtensilsCrossed,
    tint: "reward",
  },
  {
    id: "beauty",
    labelEn: "Beauty & wellness",
    labelId: "Kecantikan & wellness",
    icon: Sparkles,
    tint: "primary",
  },
  {
    id: "tech",
    labelEn: "Tech & gadgets",
    labelId: "Teknologi & gadget",
    icon: Smartphone,
    tint: "success",
  },
  { id: "travel", labelEn: "Travel", labelId: "Traveling", icon: Plane, tint: "warning" },
  { id: "fashion", labelEn: "Fashion", labelId: "Fashion", icon: Shirt, tint: "price" },
  { id: "finance", labelEn: "Finance", labelId: "Keuangan", icon: Wallet, tint: "primary" },
  { id: "auto", labelEn: "Automotive", labelId: "Otomotif", icon: Car, tint: "success" },
  { id: "home", labelEn: "Home & living", labelId: "Rumah & living", icon: Home, tint: "reward" },
  {
    id: "entertainment",
    labelEn: "Entertainment",
    labelId: "Hiburan",
    icon: Film,
    tint: "warning",
  },
  {
    id: "health",
    labelEn: "Health & fitness",
    labelId: "Kesehatan & kebugaran",
    icon: HeartPulse,
    tint: "price",
  },
  {
    id: "education",
    labelEn: "Education",
    labelId: "Pendidikan",
    icon: GraduationCap,
    tint: "primary",
  },
  { id: "sports", labelEn: "Sports", labelId: "Olahraga", icon: Trophy, tint: "success" },
];
