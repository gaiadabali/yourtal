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
 * The interest picker's catalogue (docs/tasks/phase-u-ui.md YT-0430:
 * "Interest picker with images... 15 seconds to complete"). Real content,
 * not lorem — these are the actual campaign categories the earn board
 * groups by, and they read the same in both `en-AU` and `id-ID`, since a
 * user picks interests before any campaign copy is shown.
 *
 * There are no real photographs to show (no asset pipeline exists in this
 * ticket's scope), and the brief is explicit that a placeholder must be
 * honest about the final shape rather than a grey box: `interest-picker.tsx`
 * renders each of these as a fixed-aspect-ratio tile with the icon centred
 * on a tinted token background, which is real, final-shape content (a
 * zero-network, zero-CLS SVG icon) rather than a stand-in for an image that
 * does not exist yet.
 */
export interface InterestOption {
  readonly id: string;
  readonly labelEn: string;
  readonly labelId: string;
  readonly icon: LucideIcon;
  /** Which design-token tint the tile uses, rotated across the grid so it does not read as one flat wall of colour. */
  readonly tint: "primary" | "reward" | "success" | "warning" | "price";
}

export const INTEREST_OPTIONS: readonly InterestOption[] = [
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
