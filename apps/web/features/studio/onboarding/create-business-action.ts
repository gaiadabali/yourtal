"use server";

import { redirect } from "next/navigation";
import { createBusiness } from "../studio-data";
import { createBusinessInputSchema } from "./business-onboarding-input";

const ONBOARDING_PATH = "/studio/onboarding";

/**
 * The onboarding form's Server Action (task 7.8.b) — a plain
 * `<form action={createBusinessAction}>`, zero client JS, same convention
 * `lib/api/actions.ts`'s `loginAction`/`updateMeAction` already use: a
 * validation or write failure redirects back to the form with
 * `?error=<code>` rather than a `useActionState` return value, which would
 * pull this whole form into the client bundle for no reason
 * (docs/13b-typescript-standards.md §8).
 *
 * Validates with the same `createBusinessInputSchema` the mock and (once
 * 7.1.b lands) the live BFF both parse against, so a rejection here is
 * never a surprise the server repeats in a different shape.
 */
export async function createBusinessAction(formData: FormData): Promise<void> {
  const raw = Object.fromEntries(formData.entries());
  const parsed = createBusinessInputSchema.safeParse(raw);
  if (!parsed.success) {
    const firstIssue = parsed.error.issues[0];
    const code = typeof firstIssue?.path[0] === "string" ? firstIssue.path[0] : "invalid_input";
    redirect(`${ONBOARDING_PATH}?error=${code}`);
  }

  try {
    await createBusiness(parsed.data);
  } catch {
    redirect(`${ONBOARDING_PATH}?error=create_failed`);
  }

  redirect("/studio");
}
