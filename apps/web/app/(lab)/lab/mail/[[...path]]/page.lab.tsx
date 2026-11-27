import { notFound } from "next/navigation";
import { MailLabScreen } from "@/features/spambank/mail-lab";
import { resolveMailRoute } from "@/features/spambank/mail-routes";

type Query = Record<string, string | string[] | undefined>;

/** `/lab/mail/...`: the mail screens on the in-memory client. Same URL table as `/mail`. */
export default async function LabMailPage(props: {
  params: Promise<{ path?: string[] }>;
  searchParams: Promise<Query>;
}) {
  const [{ path }, query] = await Promise.all([props.params, props.searchParams]);
  const route = resolveMailRoute(path, query);
  if (!route) notFound();
  return <MailLabScreen route={route} />;
}
