import { requireStaffSession } from "@/features/staff/staff-session";
import { SpambankAutoreplyScreen } from "@/features/staff/spambank/spambank-autoreply-screen";

export const dynamic = "force-dynamic";

/** `/staff/spambank/autoreply` (BUILD.md 4.6, T9): mode, pause, today's counts, blocklist results, kill switch. */
export default async function StaffSpambankAutoreplyPage() {
  const session = await requireStaffSession();
  return <SpambankAutoreplyScreen session={session} />;
}
