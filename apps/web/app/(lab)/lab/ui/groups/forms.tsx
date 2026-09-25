"use client";

import * as React from "react";
import { ChoiceCard } from "@yourtal/ui/choice-card";
import { Input } from "@yourtal/ui/input";
import { NativeSelect } from "@yourtal/ui/native-select";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@yourtal/ui/select";
import { Textarea } from "@yourtal/ui/textarea";
import { GalleryRow, GallerySection } from "../lib/gallery-section";
import { placeholderImage } from "../lib/placeholder-image";

interface SelectFieldProps {
  label: string;
  helpText?: string;
  errorMessage?: string;
  defaultValue: string;
}

/**
 * Select has no built-in help/error slot (unlike Input/Textarea/NativeSelect,
 * which take those as props) — wired by hand here, same aria-describedby
 * pattern the other fields use internally. `aria-labelledby` ties the
 * accessible name to the visible label text (WCAG 2.5.3).
 */
function SelectField({ label, helpText, errorMessage, defaultValue }: SelectFieldProps) {
  const id = React.useId();
  const labelId = `${id}-label`;
  const helpId = helpText ? `${id}-help` : undefined;
  const errorId = errorMessage ? `${id}-error` : undefined;
  const describedBy = [helpId, errorId].filter(Boolean).join(" ") || undefined;

  return (
    <div className="flex w-56 flex-col gap-1.5">
      <span id={labelId} className="text-label font-sans text-fg">
        {label}
      </span>
      <Select defaultValue={defaultValue}>
        <SelectTrigger
          aria-labelledby={labelId}
          aria-describedby={describedBy}
          aria-invalid={errorMessage ? true : undefined}
        >
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="marketer">Marketer</SelectItem>
          <SelectItem value="finance">Finance</SelectItem>
          <SelectItem value="support">Support</SelectItem>
        </SelectContent>
      </Select>
      {helpText ? (
        <p id={helpId} className="text-caption font-sans text-fg-muted">
          {helpText}
        </p>
      ) : null}
      {errorMessage ? (
        <p id={errorId} role="alert" className="text-caption font-sans text-danger-solid">
          {errorMessage}
        </p>
      ) : null}
    </div>
  );
}

/** Text/select inputs and the choice-card radio group — every form primitive. */
export function FormsGroup() {
  return (
    <>
      <GallerySection
        id="forms"
        title="Form fields"
        description="Input, Textarea, NativeSelect and Select, each with a plain, help and error state."
      >
        <GalleryRow label="Input">
          <Input label="Email" type="email" placeholder="you@example.com" className="w-56" />
          <Input
            label="Display name"
            helpText="Shown next to your comments and earned points."
            className="w-56"
          />
          <Input
            label="Redemption code"
            defaultValue="AB12-CD"
            errorMessage="That code has expired."
            className="w-56"
          />
        </GalleryRow>
        <GalleryRow label="Textarea">
          <Textarea label="Feedback" placeholder="Tell us what worked" className="w-56" />
          <Textarea
            label="Report a problem"
            helpText="Include what you were watching when it happened."
            className="w-56"
          />
          <Textarea
            label="Cancellation reason"
            errorMessage="This field is required."
            className="w-56"
          />
        </GalleryRow>
        <GalleryRow label="NativeSelect">
          <NativeSelect label="Region" defaultValue="au" className="w-56">
            <option value="au">Australia</option>
            <option value="id">Indonesia</option>
          </NativeSelect>
          <NativeSelect
            label="Payout method"
            helpText="You can change this any time before cash-out."
            defaultValue="voucher"
            className="w-56"
          >
            <option value="voucher">Voucher</option>
            <option value="wallet">Wallet credit</option>
          </NativeSelect>
          <NativeSelect
            label="Language"
            errorMessage="Choose a supported language."
            defaultValue=""
            className="w-56"
          >
            <option value="" disabled>
              Choose one
            </option>
            <option value="en-AU">English (Australia)</option>
            <option value="id-ID">Bahasa Indonesia</option>
          </NativeSelect>
        </GalleryRow>
        <GalleryRow label="Select">
          <SelectField label="Role" defaultValue="marketer" />
          <SelectField
            label="Notification channel"
            helpText="Only one channel gets the daily digest."
            defaultValue="finance"
          />
          <SelectField
            label="Escalation team"
            errorMessage="Pick a team before saving."
            defaultValue="support"
          />
        </GalleryRow>
      </GallerySection>

      <GallerySection
        id="choice-cards"
        title="ChoiceCard"
        description="A big tappable card backed by a real radio input, so keyboard grouping and validation are native."
      >
        <GalleryRow label="Delivery method (radio group)">
          <ChoiceCard
            name="delivery"
            title="Digital voucher"
            description="Delivered to your account instantly."
            media={
              <img
                src={placeholderImage("digital-voucher", 320, 120)}
                alt=""
                className="h-24 w-full object-cover"
              />
            }
            defaultChecked
          />
          <ChoiceCard
            name="delivery"
            title="Partner pickup"
            description="Collect in-store within 30 days."
            media={
              <img
                src={placeholderImage("partner-pickup", 320, 120)}
                alt=""
                className="h-24 w-full object-cover"
              />
            }
          />
        </GalleryRow>
      </GallerySection>
    </>
  );
}
