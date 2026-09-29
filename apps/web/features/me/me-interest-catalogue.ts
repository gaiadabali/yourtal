import {
  Backpack,
  Baby,
  BookOpen,
  Car,
  Clapperboard,
  Dumbbell,
  Film,
  GraduationCap,
  Gamepad2,
  Home,
  Plane,
  Shirt,
  Smartphone,
  Sparkles,
  Trophy,
  Tv,
  UtensilsCrossed,
  Wallet,
  Wifi,
  Wrench,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { INTEREST_TAXONOMY, TEEN_INTEREST_NODE_IDS } from "@yourtal/contracts/interest/taxonomy";

/**
 * The interest picker on Me shows the taxonomy's ROOT categories only
 * (~15), not all ~70 nodes (TASKS.md 6.7.a doesn't ask for the full tree,
 * and a flat 70-tile grid is not a real picker). `INTEREST_TAXONOMY` is the
 * single source of truth for which ids exist — `interests.controller.ts`'s
 * `isKnownInterestNode` rejects anything else, so this list is derived
 * from it rather than hand-duplicated (the old `me-interest-option.ts` this
 * replaces hand-duplicated onboarding's own local copy, which was never
 * checked against the real taxonomy and included "beauty"/"health" —
 * blocked terms `defineTaxonomy` would have thrown on had either ever
 * reached it as a real node id).
 *
 * Only an icon/tint mapping lives here; the label is a translation key
 * (`interests.categories.<id>`) in the `me` catalogue, falling back to the
 * taxonomy's own English label if a root is ever added before its
 * translation is.
 */
export interface MeInterestCategory {
  readonly id: string;
  readonly fallbackLabel: string;
  readonly icon: LucideIcon;
}

const ICONS: Record<string, LucideIcon> = {
  "food-and-drink": UtensilsCrossed,
  "personal-care": Sparkles,
  fashion: Shirt,
  electronics: Smartphone,
  telco: Wifi,
  transport: Car,
  finance: Wallet,
  fitness: Trophy,
  education: GraduationCap,
  travel: Plane,
  home: Home,
  entertainment: Film,
  family: Baby,
  services: Wrench,
  "digital-goods": Gamepad2,
};

export const ME_INTEREST_CATEGORIES: readonly MeInterestCategory[] = [...INTEREST_TAXONOMY.values()]
  .filter((node) => node.parent === null)
  .map((node) => ({
    id: node.id,
    fallbackLabel: node.label,
    icon: ICONS[node.id] ?? Sparkles,
  }));

const TEEN_ICONS: Record<string, LucideIcon> = {
  games: Gamepad2,
  books: BookOpen,
  "school-supplies": Backpack,
  sportswear: Dumbbell,
  streaming: Tv,
  cinema: Clapperboard,
};

/**
 * 12.2.a: a teen's picker offers ONLY these six leaf nodes, never the adult
 * picker's ~15 roots — `TEEN_INTEREST_NODE_IDS` is the taxonomy's own list
 * (`packages/contracts`), so this stays derived rather than a second
 * hand-duplicated set. `interests.controller.ts`'s `PUT` refuses anything
 * else for a teen regardless, the same "the UI offers, the server decides"
 * shape `ME_INTEREST_CATEGORIES` already follows for `isKnownInterestNode`.
 */
export const ME_TEEN_INTEREST_CATEGORIES: readonly MeInterestCategory[] = TEEN_INTEREST_NODE_IDS.map(
  (id) => {
    const node = INTEREST_TAXONOMY.get(id);
    if (node === undefined) throw new Error(`Teen interest node "${id}" is not in the taxonomy.`);
    return { id: node.id, fallbackLabel: node.label, icon: TEEN_ICONS[node.id] ?? Sparkles };
  },
);
