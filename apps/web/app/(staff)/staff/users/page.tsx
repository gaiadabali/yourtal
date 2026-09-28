import { getTranslations } from "next-intl/server";
import { EmptyState } from "@yourtal/ui/empty-state";
import { PageHeader } from "@yourtal/ui/page-header";
import { requireStaffSession } from "@/features/staff/staff-session";
import { searchStaffUsers } from "@/features/staff/users/staff-users-data";
import { StaffUsersResults } from "@/features/staff/users/staff-users-results";
import { StaffUsersSearchForm } from "@/features/staff/users/staff-users-search-form";

function stringParam(value: string | string[] | undefined): string {
  return typeof value === "string" ? value : "";
}

/** `/staff/users`, TASKS.md 9.4.a: search by email or user id, optionally within a region. */
export default async function StaffUsersPage(props: PageProps<"/staff/users">) {
  await requireStaffSession();
  const searchParams = await props.searchParams;
  const email = stringParam(searchParams.email);
  const userId = stringParam(searchParams.userId);
  const regionParam = stringParam(searchParams.region);
  const region = regionParam === "AU" || regionParam === "ID" ? regionParam : undefined;
  const t = await getTranslations("staff");

  const hasQuery = email.length > 0 || userId.length > 0;
  const results = hasQuery
    ? await searchStaffUsers({
        ...(email.length > 0 ? { email } : {}),
        ...(userId.length > 0 ? { userId } : {}),
        ...(region === undefined ? {} : { region }),
      })
    : [];

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title={t("users.title")} description={t("users.intro")} />
      <StaffUsersSearchForm
        t={t}
        defaultEmail={email}
        defaultUserId={userId}
        defaultRegion={regionParam}
      />
      {hasQuery ? (
        <StaffUsersResults t={t} results={results} />
      ) : (
        <EmptyState
          title={t("users.searchPromptTitle")}
          description={t("users.searchPromptDescription")}
        />
      )}
    </div>
  );
}
