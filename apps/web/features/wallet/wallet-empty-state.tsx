import { getTranslations } from "next-intl/server";
import { Clapperboard, Coins, Ticket } from "lucide-react";
import { Button } from "@yourtal/ui/button";

/**
 * 13.19.e: an empty wallet explains the loop in three steps (watch, earn,
 * redeem), with one way forward: Home.
 */
export async function WalletEmptyState() {
  const t = await getTranslations("wallet");
  const steps = [
    { icon: Clapperboard, title: t("emptyState.watchTitle"), body: t("emptyState.watchBody") },
    { icon: Coins, title: t("emptyState.earnTitle"), body: t("emptyState.earnBody") },
    { icon: Ticket, title: t("emptyState.redeemTitle"), body: t("emptyState.redeemBody") },
  ];
  return (
    <section
      aria-labelledby="wallet-empty"
      className="flex flex-col gap-6 rounded-sheet border border-border-subtle bg-surface p-6 sm:p-8"
    >
      <div className="flex flex-col gap-2">
        <h2 id="wallet-empty" className="font-display text-headline font-bold text-fg">
          {t("emptyState.heading")}
        </h2>
        <p className="max-w-prose text-body font-sans text-fg-muted">{t("emptyState.body")}</p>
      </div>
      {/* A real sequence: watching comes before earning, earning before redeeming. */}
      <ol className="grid gap-4 sm:grid-cols-3">
        {steps.map((step, index) => (
          <li key={step.title} className="flex flex-col gap-2 rounded-card bg-canvas p-4">
            <span className="flex items-center gap-2 text-caption font-sans font-bold text-accent">
              <step.icon aria-hidden="true" className="h-5 w-5" />
              {t("emptyState.step", { number: index + 1 })}
            </span>
            <span className="text-body font-sans font-semibold text-fg">{step.title}</span>
            <span className="text-body-sm font-sans text-fg-muted">{step.body}</span>
          </li>
        ))}
      </ol>
      <div>
        <Button asChild size="lg">
          <a href="/home">{t("emptyState.cta")}</a>
        </Button>
      </div>
    </section>
  );
}
