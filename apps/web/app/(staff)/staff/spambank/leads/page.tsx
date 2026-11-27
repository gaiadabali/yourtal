import { requireStaffSession } from "@/features/staff/staff-session";
import { SpambankLeadsScreen } from "@/features/staff/spambank/spambank-leads-screen";
import { LEAD_STATUSES, type LeadStatus } from "@/features/staff/spambank/spambank-staff-contract";

export const dynamic = "force-dynamic";

function one(value: string | string[] | undefined): string | undefined {
  return typeof value === "string" && value !== "" ? value : undefined;
}

/** `/staff/spambank/leads` (BUILD.md 4.7, T9): the brands mailing Spambank users, for GOD's sales team. */
export default async function StaffSpambankLeadsPage(props: PageProps<"/staff/spambank/leads">) {
  const session = await requireStaffSession();
  const searchParams = await props.searchParams;
  const status = one(searchParams.status);
  const q = one(searchParams.q);
  const cursor = one(searchParams.cursor);
  return (
    <SpambankLeadsScreen
      session={session}
      query={{
        ...((LEAD_STATUSES as readonly string[]).includes(status ?? "")
          ? { status: status as LeadStatus }
          : {}),
        ...(q === undefined ? {} : { q: q.slice(0, 200) }),
        ...(cursor === undefined ? {} : { cursor }),
      }}
    />
  );
}
