import { randomUUID } from "node:crypto";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { requireStaffSession } from "@/features/staff/staff-session";
import { getStaffUser, getStaffUserLedger } from "@/features/staff/users/staff-users-data";
import { StaffUserDetailScreen } from "@/features/staff/users/staff-user-detail-screen";

function stringParam(value: string | string[] | undefined): string | undefined {
  return typeof value === "string" ? value : undefined;
}

/** `/staff/users/:userId`, TASKS.md 9.4.a-d: one account's whole staff screen. */
export default async function StaffUserDetailPage(props: PageProps<"/staff/users/[userId]">) {
  const session = await requireStaffSession();
  const { userId } = await props.params;
  const searchParams = await props.searchParams;

  const [user, ledger] = await Promise.all([getStaffUser(userId), getStaffUserLedger(userId)]);
  if (!user) notFound();

  const t = await getTranslations("staff");
  const flash = ["suspended", "released", "goodwill", "trust_tier", "error", "invalid"].find(
    (key) => stringParam(searchParams[key]) !== undefined,
  );

  return (
    <StaffUserDetailScreen
      t={t}
      session={session}
      user={user}
      ledger={ledger}
      idempotencyKey={randomUUID()}
      flash={flash}
    />
  );
}
