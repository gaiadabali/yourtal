import type { Route } from "next";

/** Where the boost editor's "add a card" link lands on the Billing page (5.1.a). */
export const CARD_PANEL_ID = "card-for-boosts";

export function cardPanelHref(businessId: string): Route {
  return `/studio/billing?business=${encodeURIComponent(businessId)}#${CARD_PANEL_ID}` as Route;
}
