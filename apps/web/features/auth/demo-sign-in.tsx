import { getTranslations } from "next-intl/server";
import { z } from "zod";
import { apiFetch } from "@/lib/api/api-fetch";
import { isStaging } from "@/features/shell/app-env";
import { DemoSignInList } from "@/features/auth/demo-sign-in-list";

const demoPeopleSchema = z.object({
  people: z.array(
    z.object({ email: z.string(), displayName: z.string(), region: z.enum(["AU", "ID"]) }),
  ),
});

/**
 * Staging test kit: "Continue as <demo person>" under the sign-in form. Off
 * staging it renders nothing and never calls the API (which is 404 there too).
 */
export async function DemoSignIn({ returnTo }: { returnTo?: string | undefined }) {
  if (!isStaging()) return null;
  const result = await apiFetch("/api/auth/demo-sign-in", demoPeopleSchema);
  if (!result.ok || result.data.people.length === 0) return null;
  const t = await getTranslations("auth.login");
  return (
    <details className="rounded-lg border border-border p-3">
      <summary className="cursor-pointer text-body-sm font-sans">{t("demoHeading")}</summary>
      <DemoSignInList people={result.data.people} returnTo={returnTo} />
    </details>
  );
}
