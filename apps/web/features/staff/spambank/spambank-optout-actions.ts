"use server";

import { submitOptout, type OptoutOutcome } from "./spambank-optout-data";

/** The opt-out page's button (BUILD.md 4.6): a GET never opts out, this POST does. */
export async function optOutAction(domain: string, sig: string): Promise<OptoutOutcome> {
  return submitOptout(domain, sig);
}
