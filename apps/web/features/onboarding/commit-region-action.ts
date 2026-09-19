"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import type { Route } from "next";
import { regionSchema } from "@yourtal/contracts/region";
import { ONBOARDING_REGION_COOKIE } from "./onboarding-region-cookie";
import { parseReturnTo, withReturnTo } from "./onboarding-return-to";

/**
 * The one piece of onboarding state that must survive past this flow: the
 * region a user picked at registration (docs/tasks/phase-u-ui.md YT-0430's
 * region criterion).
 *
 * `apps/web/features/region/get-region.ts` (YT-0405, built in parallel) reads
 * this exact cookie name today — `"yourtal-region"` — via
 * `regionSchema.safeParse`, and `app/(app)/layout.tsx` already calls
 * `getRegion()` and wraps every tab route in `<RegionProvider>`. Before this
 * ticket, nothing ever wrote that cookie, so every screen silently defaulted
 * to `getRegion()`'s hardcoded `"ID"` fallback (see that file's doc comment:
 * "until something writes a validated value to the yourtal-region cookie").
 * This action is that write — the region picked here is what every other
 * screen in the app renders in, from the very next request.
 *
 * The constant itself lives in `onboarding-region-cookie.ts`, not here: a
 * `"use server"` file may only export async functions (Next.js's Server
 * Actions constraint), so a plain `export const` in this file fails the
 * build.
 */

/**
 * Server Action bound to each region card's `<form action={...}>` in
 * `region-picker.tsx`. Zero client JS is needed for this step: the browser
 * posts the form, this validates the choice against the real `regionSchema`
 * (safe here — Server Actions execute on the server; the client bundle
 * only gets an opaque reference, never this function's body or its Zod
 * import, docs/13b-typescript-standards.md section 8), sets the cookie, and
 * redirects on to consent.
 *
 * An invalid submission (only reachable by a hand-crafted request, since the
 * form's own hidden input only ever carries "AU" or "ID") redirects back to
 * the picker rather than throwing, so a malformed request degrades to "ask
 * again" instead of a 500.
 */
export async function commitRegionAction(formData: FormData): Promise<void> {
  const returnToEntry = formData.get("returnTo");
  const returnTo = parseReturnTo(typeof returnToEntry === "string" ? returnToEntry : undefined);

  const parsed = regionSchema.safeParse(formData.get("region"));
  if (!parsed.success) {
    // typedRoutes only validates literal href strings (see campaign-card.tsx
    // for the usual case); `withReturnTo`'s return type is a plain `string`
    // once `returnTo` is folded in, so this needs the same cast. Safe here
    // because `returnTo` is `parseReturnTo`'s validated output, and
    // "/onboarding" itself is a real, literal, always-valid route.
    redirect(withReturnTo("/onboarding", returnTo) as Route);
  }

  const region = parsed.data;
  const cookieStore = await cookies();
  cookieStore.set(ONBOARDING_REGION_COOKIE, region, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 365,
  });

  redirect(withReturnTo(`/onboarding/${region}/consent`, returnTo) as Route);
}
