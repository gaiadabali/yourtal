"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { StaffReasonDialogButton } from "../staff-reason-dialog-button";
import { decideCharity } from "@/features/charity/charity-actions";

/** 13.21.a: approve or reject one pending application, each with a required reason. */
export function StaffCharityDecision({
  charityId,
  name,
  region,
}: {
  charityId: string;
  name: string;
  region: string;
}) {
  const t = useTranslations("staff");
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);

  async function decide(decision: "approve" | "reject", reason: string) {
    const result = await decideCharity(charityId, decision, reason);
    if (!result.ok) {
      setError(t("charities.failed", { message: result.message }));
      return false;
    }
    setError(null);
    router.refresh();
    return true;
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <StaffReasonDialogButton
        triggerLabel={t("charities.approve")}
        triggerVariant="primary"
        dialogTitle={t("charities.approveTitle", { name })}
        dialogBody={t("charities.approveBody", { region })}
        submitLabel={t("charities.approve")}
        onSubmit={(reason) => decide("approve", reason)}
      />
      <StaffReasonDialogButton
        triggerLabel={t("charities.reject")}
        triggerVariant="danger"
        dialogTitle={t("charities.rejectTitle", { name })}
        dialogBody={t("charities.rejectBody")}
        submitLabel={t("charities.reject")}
        onSubmit={(reason) => decide("reject", reason)}
      />
      {error === null ? null : (
        <p role="alert" className="font-sans text-body-sm text-danger-solid">
          {error}
        </p>
      )}
    </div>
  );
}
