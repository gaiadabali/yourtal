"use client";

import { useId, useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@yourtal/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTrigger,
} from "@yourtal/ui/dialog";
import { Heading } from "@yourtal/ui/heading";
import { NativeSelect } from "@yourtal/ui/native-select";
import { Text } from "@yourtal/ui/text";
import { Textarea } from "@yourtal/ui/textarea";
import {
  allowedAudiencesFor,
  allowedCategoriesFor,
  type Audience,
  type ContentCategory,
} from "./campaign-category-policy";

export interface StaffListingApproveDialogButtonProps {
  readonly region: "AU" | "ID";
  readonly declaredAudience: Audience;
  readonly declaredCategory: ContentCategory;
  readonly submitLabel: string;
  /** Resolves once the action settles. `false` leaves the dialog open so nothing entered is lost. */
  readonly onSubmit: (params: {
    reason: string;
    audience: Audience;
    contentCategory: ContentCategory;
  }) => Promise<boolean>;
}

/**
 * TASKS.md 12.4.c (F83): the listing half of "confirm or change" (1.1.d) --
 * the same dialog `StaffCampaignApproveDialogButton` (9.2.d) already gives
 * campaigns, reusing the identical `campaign-category-policy.ts` restatement
 * of the 1.1.d table (it is not actually campaign-specific -- a listing and
 * a campaign are checked against the exact same region/category/audience
 * policy, `categoryRefusal`, server-side). The moderator sees the
 * merchant's own declared audience/category, pre-filled, and can leave them
 * (confirm) or pick different ones (change) before approving; both selects
 * only ever offer combinations 1.1.d allows for this listing's region, the
 * same narrowing the server re-checks on submit.
 */
export function StaffListingApproveDialogButton({
  region,
  declaredAudience,
  declaredCategory,
  submitLabel,
  onSubmit,
}: StaffListingApproveDialogButtonProps) {
  const t = useTranslations("staff");
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [audience, setAudience] = useState<Audience>(declaredAudience);
  const [contentCategory, setContentCategory] = useState<ContentCategory>(declaredCategory);
  const [isPending, startTransition] = useTransition();
  const reasonInputId = useId();
  const trimmed = reason.trim();

  const categories = allowedCategoriesFor(region);
  const audiences = allowedAudiencesFor(region, contentCategory);
  const audienceLabels: Record<Audience, string> = {
    all_ages: t("moderation.audienceAllAges"),
    teen: t("moderation.audienceTeen"),
    adult: t("moderation.audienceAdult"),
    parents: t("moderation.audienceParents"),
  };

  function reset() {
    setReason("");
    setAudience(declaredAudience);
    setContentCategory(declaredCategory);
  }

  function selectCategory(next: ContentCategory) {
    setContentCategory(next);
    // 1.1.d: an adult_only category forces audience -- the same auto-narrowing
    // `allowedAudiencesFor` already reflects in the select's own options.
    const nextAudiences = allowedAudiencesFor(region, next);
    if (!nextAudiences.includes(audience)) {
      setAudience(nextAudiences[0] as Audience);
    }
  }

  function submit() {
    if (trimmed === "") return;
    startTransition(() => {
      void onSubmit({ reason: trimmed, audience, contentCategory }).then((ok) => {
        if (ok) {
          setOpen(false);
          reset();
        }
      });
    });
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) reset();
      }}
    >
      <DialogTrigger asChild>
        <Button variant="primary">{t("moderation.approveCta")}</Button>
      </DialogTrigger>
      <DialogContent closeLabel={t("dialog.close")}>
        <DialogHeader>
          <Heading level={2} size="title">
            {t("moderation.approveListingDialogTitle")}
          </Heading>
          <Text tone="muted">{t("moderation.approveListingDialogBody")}</Text>
        </DialogHeader>

        <Text size="body-sm" tone="muted">
          {t("moderation.confirmOrChangeHint")}
        </Text>

        <div className="flex flex-col gap-4 sm:flex-row">
          <div className="flex-1">
            <NativeSelect
              label={t("moderation.categoryLabel")}
              value={contentCategory}
              onChange={(event) => selectCategory(event.target.value as ContentCategory)}
            >
              {categories.map((category) => (
                <option key={category} value={category}>
                  {category}
                </option>
              ))}
            </NativeSelect>
          </div>
          <div className="flex-1">
            <NativeSelect
              label={t("moderation.audienceLabel")}
              value={audience}
              onChange={(event) => setAudience(event.target.value as Audience)}
            >
              {audiences.map((value) => (
                <option key={value} value={value}>
                  {audienceLabels[value]}
                </option>
              ))}
            </NativeSelect>
          </div>
        </div>

        <Textarea
          id={reasonInputId}
          label={t("dialog.reasonLabel")}
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          required
        />
        <DialogFooter>
          <Button variant="ghost" onClick={() => setOpen(false)} disabled={isPending}>
            {t("dialog.cancel")}
          </Button>
          <Button onClick={submit} loading={isPending} disabled={trimmed === ""}>
            {submitLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
