"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import type { StaffBusinessDetail } from "@yourtal/contracts/staff/businesses";
import { Badge } from "@yourtal/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@yourtal/ui/card";
import { KeyValue } from "@yourtal/ui/key-value";
import { Notice } from "@yourtal/ui/notice";
import { StatusBadge } from "@yourtal/ui/status-badge";
import { Text } from "@yourtal/ui/text";
import { StaffReasonDialogButton } from "../staff-reason-dialog-button";
import {
  approveBusinessKybAction,
  reinstateBusinessAction,
  rejectBusinessKybAction,
  suspendBusinessAction,
} from "./staff-business-actions";

export interface StaffBusinessDetailScreenProps {
  readonly initial: StaffBusinessDetail;
}

/** TASKS.md 9.3.a: one business's KYB review and suspension controls. */
export function StaffBusinessDetailScreen({ initial }: StaffBusinessDetailScreenProps) {
  const t = useTranslations("staff");
  const [business, setBusiness] = useState(initial);
  const [error, setError] = useState<string | null>(null);

  async function run(action: (id: string, reason: string) => Promise<{
    ok: boolean;
    business?: StaffBusinessDetail;
    error?: { message: string };
  }>, reason: string): Promise<boolean> {
    const result = await action(business.id, reason);
    if (result.ok && result.business !== undefined) {
      setBusiness(result.business);
      setError(null);
      return true;
    }
    setError(result.error?.message ?? t("errors.actionFailed"));
    return false;
  }

  const pendingDocuments = business.kybDocuments.filter((doc) => doc.status === "submitted");

  return (
    <div className="flex flex-col gap-6">
      {error !== null ? <Notice tone="danger">{error}</Notice> : null}

      <Card>
        <CardHeader>
          <CardTitle as="h2">{t("businesses.profileTitle")}</CardTitle>
        </CardHeader>
        <CardContent>
          <KeyValue
            items={[
              { key: "legalName", label: t("businesses.legalName"), value: business.legalName },
              { key: "handle", label: t("businesses.handle"), value: business.handle },
              { key: "region", label: t("businesses.columnRegion"), value: t(`regions.${business.region}`) },
              {
                key: "taxId",
                label: t("businesses.taxId"),
                value: `${business.taxIdKind} ${business.taxIdValue}`,
              },
              {
                key: "status",
                label: t("businesses.columnStatus"),
                value:
                  business.suspendedAt === null ? (
                    <StatusBadge status="info">{t("businesses.active")}</StatusBadge>
                  ) : (
                    <StatusBadge status="danger">{t("businesses.suspended")}</StatusBadge>
                  ),
              },
            ]}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle as="h2">{t("businesses.kybTitle")}</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div className="flex items-center gap-2">
            <Text>{t("businesses.kybStatus")}</Text>
            <StatusBadge status={business.isVerified ? "success" : "neutral"}>
              {business.isVerified ? t("businesses.verified") : t("businesses.unverified")}
            </StatusBadge>
          </div>
          {business.kybDocuments.length === 0 ? (
            <Text tone="muted">{t("businesses.noDocuments")}</Text>
          ) : (
            <ul className="flex flex-col gap-2">
              {business.kybDocuments.map((doc) => (
                <li
                  key={doc.id}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-control border border-border-subtle p-3"
                >
                  <Text size="body-sm">{t(`businesses.documentType.${doc.documentType}`)}</Text>
                  <Badge
                    variant={
                      doc.status === "verified"
                        ? "success"
                        : doc.status === "rejected"
                          ? "danger"
                          : "secondary"
                    }
                  >
                    {t(`businesses.documentStatus.${doc.status}`)}
                  </Badge>
                </li>
              ))}
            </ul>
          )}
          <div className="flex flex-wrap gap-2">
            <StaffReasonDialogButton
              triggerLabel={t("businesses.approveKybCta")}
              triggerVariant="primary"
              dialogTitle={t("businesses.approveKybDialogTitle")}
              dialogBody={t("businesses.approveKybDialogBody")}
              submitLabel={t("businesses.approveKybSubmit")}
              onSubmit={(reason) => run(approveBusinessKybAction, reason)}
            />
            <StaffReasonDialogButton
              triggerLabel={t("businesses.rejectKybCta")}
              triggerVariant="danger"
              dialogTitle={t("businesses.rejectKybDialogTitle")}
              dialogBody={t("businesses.rejectKybDialogBody")}
              submitLabel={t("businesses.rejectKybSubmit")}
              onSubmit={(reason) => run(rejectBusinessKybAction, reason)}
            />
          </div>
          {pendingDocuments.length === 0 && business.kybDocuments.length > 0 ? (
            <Text tone="muted" size="caption">
              {t("businesses.noPendingDocuments")}
            </Text>
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle as="h2">{t("businesses.suspensionTitle")}</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {business.suspendedAt === null ? (
            <Text tone="muted">{t("businesses.notSuspended")}</Text>
          ) : (
            <Text tone="muted">
              {t("businesses.suspendedReason", { reason: business.suspendedReason ?? "" })}
            </Text>
          )}
          <div className="flex flex-wrap gap-2">
            {business.suspendedAt === null ? (
              <StaffReasonDialogButton
                triggerLabel={t("businesses.suspendCta")}
                triggerVariant="danger"
                dialogTitle={t("businesses.suspendDialogTitle")}
                dialogBody={t("businesses.suspendDialogBody")}
                submitLabel={t("businesses.suspendSubmit")}
                onSubmit={(reason) => run(suspendBusinessAction, reason)}
              />
            ) : (
              <StaffReasonDialogButton
                triggerLabel={t("businesses.reinstateCta")}
                triggerVariant="primary"
                dialogTitle={t("businesses.reinstateDialogTitle")}
                dialogBody={t("businesses.reinstateDialogBody")}
                submitLabel={t("businesses.reinstateSubmit")}
                onSubmit={(reason) => run(reinstateBusinessAction, reason)}
              />
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
