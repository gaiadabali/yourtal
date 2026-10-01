import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { getLocale, getTranslations } from "next-intl/server";
import { feedResponseSchema } from "@yourtal/contracts/feed";
import { isStaging } from "@/features/shell/app-env";
import { apiFetch } from "@/lib/api/api-fetch";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Review YourTal",
  robots: { index: false, follow: false },
};

const PEOPLE = ["viewer", "adult", "teen", "guardian", "owner", "member", "finance"] as const;
const COUNTER_PIN = "2468";

/** One logged-out video per region for the "watch without an account" journey. */
async function openViewingHref(region: "AU" | "ID"): Promise<string | null> {
  const feed = await apiFetch(`/api/feed?surface=home&region=${region}`, feedResponseSchema);
  const item = feed.ok
    ? feed.data.items.find((i) => i.openViewing && i.kind === "long_form")
    : undefined;
  return item ? `/${region.toLowerCase()}/c/${item.campaignId}/watch` : null;
}

/**
 * 13.2.a: the reviewer's guide, staging only. Lists the non-staff demo logins
 * (never staff, F5), the journeys with direct links, the tools and what is
 * simulated. The shared demo password covers staff too, so it is never shown;
 * a separate review password is, once A provides it (F95, 13.2.b).
 */
export default async function ReviewPage() {
  if (!isStaging()) notFound();
  const [t, locale, openAu, openId] = await Promise.all([
    getTranslations("review"),
    getLocale(),
    openViewingHref("AU"),
    openViewingHref("ID"),
  ]);
  const password = process.env["STAGING_REVIEW_PASSWORD"];
  const journeys: { key: string; href: string | null }[] = [
    { key: "home", href: "/home" },
    { key: "shorts", href: "/shorts" },
    { key: "watch", href: "/home" },
    { key: "store", href: "/store" },
    { key: "wallet", href: "/wallet" },
    { key: "gift", href: "/wallet" },
    { key: "auction", href: "/auctions" },
    { key: "boost", href: "/studio/campaigns" },
    { key: "theme", href: "/me" },
    { key: "open", href: locale === "id-ID" ? (openId ?? openAu) : (openAu ?? openId) },
  ];
  const link = "font-sans font-semibold text-accent underline-offset-4 hover:underline";

  return (
    <main
      data-surface="viewer"
      className="mx-auto flex min-h-dvh w-full max-w-4xl flex-col gap-10 bg-canvas px-4 py-10 text-fg sm:px-6"
    >
      <header className="flex flex-col gap-3">
        <h1 className="font-display text-headline font-bold">{t("title")}</h1>
        <p className="max-w-prose text-body font-sans text-fg-muted">{t("intro")}</p>
      </header>

      <section aria-labelledby="review-logins" className="flex flex-col gap-4">
        <h2 id="review-logins" className="font-display text-title font-bold">
          {t("logins.heading")}
        </h2>
        <p className="text-body-sm font-sans text-fg-muted">{t("logins.intro")}</p>
        <p className="rounded-card border border-border-subtle bg-surface p-4 text-body-sm font-sans">
          {password ? (
            <>
              {t("logins.passwordShown")}{" "}
              <code className="font-mono font-semibold">{password}</code>
            </>
          ) : (
            t("logins.passwordAsk")
          )}
        </p>
        {/* Phones get one card per person; the table needs about 600 px. */}
        <ul className="flex flex-col gap-2 sm:hidden">
          {PEOPLE.map((person) => (
            <li
              key={person}
              className="rounded-card border border-border-subtle bg-surface p-3 text-body-sm font-sans"
            >
              <p className="font-semibold">{t(`logins.people.${person}.who`)}</p>
              <p className="mt-1 break-all font-mono text-caption">
                {t("logins.au")}: {`${person}.au@demo.yourtal.test`}
              </p>
              <p className="break-all font-mono text-caption">
                {t("logins.id")}: {`${person}.id@demo.yourtal.test`}
              </p>
              <p className="mt-1 text-fg-muted">{t(`logins.people.${person}.try`)}</p>
            </li>
          ))}
        </ul>
        <div className="hidden overflow-hidden rounded-card border border-border-subtle sm:block">
          <table className="w-full text-left text-body-sm font-sans">
            <thead className="bg-surface-sunken text-caption text-fg-muted">
              <tr>
                <th scope="col" className="px-3 py-2">
                  {t("logins.role")}
                </th>
                <th scope="col" className="px-3 py-2">
                  {t("logins.au")}
                </th>
                <th scope="col" className="px-3 py-2">
                  {t("logins.id")}
                </th>
                <th scope="col" className="px-3 py-2">
                  {t("logins.tryThis")}
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border-subtle">
              {PEOPLE.map((person) => (
                <tr key={person}>
                  <th scope="row" className="px-3 py-2 font-semibold">
                    {t(`logins.people.${person}.who`)}
                  </th>
                  <td className="px-3 py-2 font-mono text-caption">{`${person}.au@demo.yourtal.test`}</td>
                  <td className="px-3 py-2 font-mono text-caption">{`${person}.id@demo.yourtal.test`}</td>
                  <td className="px-3 py-2 text-fg-muted">{t(`logins.people.${person}.try`)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="text-body-sm font-sans">
          {t("logins.counter", { pairUrl: "/merchant/pair", pin: COUNTER_PIN })}{" "}
          <a href="/merchant/pair" className={link}>
            /merchant/pair
          </a>
        </p>
        <p className="text-body-sm font-sans text-fg-muted">{t("logins.staffNote")}</p>
        <p>
          <a href="/login" className={link}>
            /login
          </a>
        </p>
      </section>

      <section aria-labelledby="review-journeys" className="flex flex-col gap-4">
        <h2 id="review-journeys" className="font-display text-title font-bold">
          {t("journeys.heading")}
        </h2>
        <ul className="flex flex-col gap-3">
          {journeys.map((journey) => (
            <li
              key={journey.key}
              className="flex flex-col gap-1 rounded-card border border-border-subtle bg-surface p-4 sm:flex-row sm:items-center sm:justify-between sm:gap-4"
            >
              <span className="text-body-sm font-sans">{t(`journeys.items.${journey.key}`)}</span>
              {journey.href ? (
                <a href={journey.href} className={`${link} shrink-0 text-body-sm`}>
                  {t("open")} {journey.href.length > 24 ? "" : journey.href}
                </a>
              ) : null}
            </li>
          ))}
        </ul>
      </section>

      <section aria-labelledby="review-tools" className="flex flex-col gap-3">
        <h2 id="review-tools" className="font-display text-title font-bold">
          {t("tools.heading")}
        </h2>
        <p className="text-body-sm font-sans">
          {t("tools.clock")}{" "}
          <a href="/dev/clock" className={link}>
            /dev/clock
          </a>
        </p>
        <p className="text-body-sm font-sans">
          {t("tools.inbox")}{" "}
          <a href="/dev/inbox" className={link}>
            /dev/inbox
          </a>
        </p>
      </section>

      <section aria-labelledby="review-simulated" className="flex flex-col gap-3">
        <h2 id="review-simulated" className="font-display text-title font-bold">
          {t("simulated.heading")}
        </h2>
        <ul className="flex list-disc flex-col gap-1 pl-5 text-body-sm font-sans text-fg-muted">
          {(t.raw("simulated.items") as string[]).map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      </section>
    </main>
  );
}
