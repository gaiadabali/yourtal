import { getTranslations } from "next-intl/server";
import { Button } from "@yourtal/ui/button";
import { Card, CardContent } from "@yourtal/ui/card";
import { resetDemoWorldAction } from "./demo-reset-action";

/** Admin only, and only where demo data lives (staging and dev), never production. */
export async function DemoResetCard({ outcome }: { outcome: string | undefined }) {
  const t = await getTranslations("staff.demo");
  return (
    <Card>
      <CardContent className="flex flex-col gap-3 pt-4">
        <h2 className="text-base font-semibold">{t("title")}</h2>
        <p className="text-sm text-muted-foreground">{t("intro")}</p>
        {outcome === "queued" ? (
          <p className="text-sm" role="status">
            {t("queued")}
          </p>
        ) : null}
        {outcome === "failed" ? (
          <p className="text-sm text-destructive" role="alert">
            {t("failed")}
          </p>
        ) : null}
        <form action={resetDemoWorldAction}>
          <input type="hidden" name="idempotencyKey" value={crypto.randomUUID()} />
          <Button type="submit" variant="outline">
            {t("button")}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
