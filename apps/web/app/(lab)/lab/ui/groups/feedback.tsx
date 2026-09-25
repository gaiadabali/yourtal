"use client";

import * as React from "react";
import { AlertTriangle, Inbox, RotateCw } from "lucide-react";
import { Button } from "@yourtal/ui/button";
import { EmptyState } from "@yourtal/ui/empty-state";
import { ErrorState } from "@yourtal/ui/error-state";
import { Notice } from "@yourtal/ui/notice";
import { Progress } from "@yourtal/ui/progress";
import { Skeleton } from "@yourtal/ui/skeleton";
import { Stepper } from "@yourtal/ui/stepper";
import { GalleryRow, GallerySection } from "../lib/gallery-section";

const NOTICE_TONES = ["info", "success", "warning", "danger"] as const;

const REDEEM_STEPS = [
  { key: "select", label: "Select reward" },
  { key: "confirm", label: "Confirm" },
  { key: "deliver", label: "Delivery" },
  { key: "done", label: "Done" },
];

/** Skeleton, Progress, Notice, EmptyState, ErrorState and Stepper — the ambient status primitives. */
export function FeedbackGroup() {
  return (
    <>
      <GallerySection
        id="feedback"
        title="Skeleton and Progress"
        description="Loading placeholders and determinate progress."
      >
        <GalleryRow label="Skeleton (loading list row)">
          <div role="status" aria-label="Loading rewards" className="flex w-72 items-center gap-3">
            <Skeleton className="size-10 rounded-full" />
            <div className="flex flex-1 flex-col gap-2">
              <Skeleton className="h-3 w-2/3" />
              <Skeleton className="h-3 w-1/3" />
            </div>
          </div>
        </GalleryRow>
        <GalleryRow label="Progress">
          <div className="flex w-64 flex-col gap-3">
            <Progress value={20} aria-label="Video watched" />
            <Progress value={65} aria-label="Monthly points goal" />
            <Progress value={100} aria-label="Profile completeness" />
          </div>
        </GalleryRow>
      </GallerySection>

      <GallerySection
        id="notices"
        title="Notice"
        description="Every tone: info/success are ambient, warning/danger interrupt."
      >
        <GalleryRow label="Tones">
          {NOTICE_TONES.map((tone) => (
            <Notice
              key={tone}
              tone={tone}
              title={
                tone === "info"
                  ? "New campaigns weekly"
                  : tone === "success"
                    ? "Reward claimed"
                    : tone === "warning"
                      ? "Points expiring soon"
                      : "Payout failed"
              }
              className="w-72"
            >
              {tone === "info"
                ? "Brands add fresh videos every Monday."
                : tone === "success"
                  ? "Your voucher is in Wallet now."
                  : tone === "warning"
                    ? "Some points expire at the end of the month."
                    : "We could not process this payout. Try again."}
            </Notice>
          ))}
        </GalleryRow>
      </GallerySection>

      <GallerySection
        id="states"
        title="EmptyState and ErrorState"
        description="A list with nothing in it yet, and one that failed to load."
      >
        <GalleryRow label="EmptyState">
          <EmptyState
            icon={<Inbox className="size-8" />}
            title="No rewards yet"
            description="Watch a few videos to start earning points."
            action={<Button size="sm">Browse videos</Button>}
            className="w-80"
          />
        </GalleryRow>
        <GalleryRow label="ErrorState">
          <ErrorState
            icon={<AlertTriangle className="size-8" />}
            title="Couldn't load your wallet"
            description="Check your connection and try again."
            retry={
              <Button size="sm" leadingIcon={<RotateCw className="size-4" aria-hidden="true" />}>
                Retry
              </Button>
            }
            className="w-80"
          />
        </GalleryRow>
      </GallerySection>

      <GallerySection
        id="stepper"
        title="Stepper"
        description="Complete, current and upcoming steps."
      >
        <GalleryRow label="Redemption progress">
          <Stepper steps={REDEEM_STEPS} currentIndex={1} className="w-full max-w-xl" />
        </GalleryRow>
      </GallerySection>
    </>
  );
}
