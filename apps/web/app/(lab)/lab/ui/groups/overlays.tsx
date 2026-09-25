"use client";

import * as React from "react";
import { Button } from "@yourtal/ui/button";
import {
  BottomSheet,
  BottomSheetClose,
  BottomSheetContent,
  BottomSheetDescription,
  BottomSheetFooter,
  BottomSheetHeader,
  BottomSheetTitle,
  BottomSheetTrigger,
} from "@yourtal/ui/bottom-sheet";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@yourtal/ui/dialog";
import { Input } from "@yourtal/ui/input";
import { SegmentedControl } from "@yourtal/ui/segmented-control";
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@yourtal/ui/sheet";
import { Toaster } from "@yourtal/ui/toast/toaster";
import { useToast } from "@yourtal/ui/toast/use-toast";
import { GalleryRow, GallerySection } from "../lib/gallery-section";

const SHEET_SIDES = [
  { value: "right", label: "Right" },
  { value: "left", label: "Left" },
  { value: "top", label: "Top" },
  { value: "bottom", label: "Bottom" },
] as const;

type SheetSide = (typeof SHEET_SIDES)[number]["value"];

/** Dialog, Sheet, BottomSheet and Toast — every modal/transient surface. */
export function OverlaysGroup() {
  const [side, setSide] = React.useState<SheetSide>("right");
  const { toast: raiseToast } = useToast();

  return (
    <GallerySection
      id="overlays"
      title="Overlays"
      description="Dialog, Sheet (every side), BottomSheet and Toast."
    >
      <GalleryRow label="Dialog">
        <Dialog>
          <DialogTrigger asChild>
            <Button>Open dialog</Button>
          </DialogTrigger>
          <DialogContent closeLabel="Close dialog">
            <DialogHeader>
              <DialogTitle>Invite a teammate</DialogTitle>
              <DialogDescription>
                They can accept once the invite arrives by email.
              </DialogDescription>
            </DialogHeader>
            <Input label="Email" type="email" />
            <DialogFooter>
              <DialogClose asChild>
                <Button variant="outline">Cancel</Button>
              </DialogClose>
              <Button>Send invite</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </GalleryRow>

      <GalleryRow label="Sheet">
        <SegmentedControl
          label="Sheet side"
          options={SHEET_SIDES}
          value={side}
          onChange={setSide}
        />
        <Sheet>
          <SheetTrigger asChild>
            <Button variant="secondary">Open sheet</Button>
          </SheetTrigger>
          <SheetContent side={side} closeLabel="Close sheet">
            <SheetHeader>
              <SheetTitle>Filter videos</SheetTitle>
              <SheetDescription>Narrow the feed by category and duration.</SheetDescription>
            </SheetHeader>
            <SheetFooter>
              <SheetClose asChild>
                <Button variant="outline">Close</Button>
              </SheetClose>
              <Button>Apply</Button>
            </SheetFooter>
          </SheetContent>
        </Sheet>
      </GalleryRow>

      <GalleryRow label="BottomSheet">
        <BottomSheet>
          <BottomSheetTrigger asChild>
            <Button variant="secondary">Open bottom sheet</Button>
          </BottomSheetTrigger>
          <BottomSheetContent closeLabel="Close bottom sheet">
            <BottomSheetHeader>
              <BottomSheetTitle>Redeem reward</BottomSheetTitle>
              <BottomSheetDescription>
                Confirm you want to spend 500 points on this voucher.
              </BottomSheetDescription>
            </BottomSheetHeader>
            <BottomSheetFooter>
              <Button>Confirm redemption</Button>
              <BottomSheetClose asChild>
                <Button variant="ghost">Cancel</Button>
              </BottomSheetClose>
            </BottomSheetFooter>
          </BottomSheetContent>
        </BottomSheet>
      </GalleryRow>

      <GalleryRow label="Toast (useToast + Toaster)">
        <Button
          variant="secondary"
          onClick={() => {
            raiseToast({ title: "Saved", description: "Your changes are in.", variant: "success" });
          }}
        >
          Show success toast
        </Button>
        <Button
          variant="secondary"
          onClick={() => {
            raiseToast({
              title: "Something went wrong",
              description: "Try again in a moment.",
              variant: "danger",
            });
          }}
        >
          Show error toast
        </Button>
      </GalleryRow>
      <Toaster />
    </GallerySection>
  );
}
