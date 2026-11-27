import { notFound } from "next/navigation";
import { getLocale } from "next-intl/server";
import { ClientMessages } from "@/features/shell/client-messages";
import { MailLab } from "@/features/spambank/mail-lab";
import { resolveMailRoute } from "@/features/spambank/mail-routes";

type Query = Record<string, string | string[] | undefined>;

/** `/lab/mail/...`: the mail screens on the in-memory client. Same URL table as `/mail`. */
export default async function LabMailPage(props: {
  params: Promise<{ path?: string[] }>;
  searchParams: Promise<Query>;
}) {
  const [{ path }, query, locale] = await Promise.all([
    props.params,
    props.searchParams,
    getLocale(),
  ]);
  const route = resolveMailRoute(path, query);
  if (!route) notFound();
  return (
    <ClientMessages namespaces={["spambank"]}>
      <MailLab route={route} locale={locale === "id-ID" ? "id-ID" : "en-AU"} />
    </ClientMessages>
  );
}
