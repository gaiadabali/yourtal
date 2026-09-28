import Link from "next/link";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { PageHeader } from "@yourtal/ui/page-header";
import { requireStaffSession } from "@/features/staff/staff-session";
import { getStaffBusiness } from "@/features/staff/businesses/staff-businesses-data";
import { StaffBusinessDetailScreen } from "@/features/staff/businesses/staff-business-detail";

export interface StaffBusinessDetailPageProps {
  readonly params: Promise<{ businessId: string }>;
}

export const dynamic = "force-dynamic";

/** `/staff/businesses/:businessId` (TASKS.md 9.3.a): one business's KYB review and suspension. */
export default async function StaffBusinessDetailPage({ params }: StaffBusinessDetailPageProps) {
  await requireStaffSession();
  const { businessId } = await params;
  const [t, business] = await Promise.all([getTranslations("staff"), getStaffBusiness(businessId)]);

  if (business === null) {
    notFound();
  }

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={business.displayName}
        description={business.legalName}
        back={
          <Link
            href="/staff/businesses"
            className="text-body-sm font-sans text-fg-muted underline-offset-2 hover:underline"
          >
            {t("businesses.backToList")}
          </Link>
        }
      />
      <StaffBusinessDetailScreen initial={business} />
    </div>
  );
}
