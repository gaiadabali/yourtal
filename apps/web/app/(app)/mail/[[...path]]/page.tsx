import { notFound } from "next/navigation";
import { MailRoutesView } from "@/features/spambank/mail-routes-view";
import { resolveMailRoute } from "@/features/spambank/mail-routes";

export const metadata = { title: "Mail" };

/**
 * Every mail screen: `/mail`, `/mail/{folder}`, `/mail/message/{id}`, `/mail/compose` and
 * `/mail/search?q=`. One optional catch-all so the real route and the lab preview share one URL
 * table (`features/spambank/mail-routes.ts`); an address that is not one of those answers 404.
 *
 * The gate (unavailable, teen, not switched on) is the layout's job, so by the time this renders
 * there is a mailbox, and the app shell has mounted the mail client above it.
 */
export default async function MailPage(props: PageProps<"/mail/[[...path]]">) {
  const [{ path }, query] = await Promise.all([props.params, props.searchParams]);
  const route = resolveMailRoute(path, query);
  if (!route) notFound();
  return <MailRoutesView route={route} />;
}
