import { SpambankOptoutScreen } from "@/features/staff/spambank/spambank-optout-screen";

export const dynamic = "force-dynamic";

/** `/spambank/optout/:domain/:sig` (BUILD.md 4.6, T9): stop the auto-reply for one domain. Opens read-only; the button opts out. */
export default async function SpambankOptoutPage(
  props: PageProps<"/spambank/optout/[domain]/[sig]">,
) {
  const { domain, sig } = await props.params;
  return <SpambankOptoutScreen domain={decodeURIComponent(domain)} sig={decodeURIComponent(sig)} />;
}
