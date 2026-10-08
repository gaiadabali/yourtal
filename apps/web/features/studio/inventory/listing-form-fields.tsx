"use client";

import { useTranslations } from "next-intl";
import { Chip } from "@yourtal/ui/chip";
import { Input } from "@yourtal/ui/input";
import { NativeSelect } from "@yourtal/ui/native-select";
import { Switch } from "@yourtal/ui/switch";
import { Textarea } from "@yourtal/ui/textarea";
import type { MerchantLocation } from "@yourtal/contracts/listing/merchant-location";
import {
  AUDIENCES,
  CONTENT_CATEGORIES,
  categoryStatusFor,
} from "../campaign-builder/campaign-editor-details";
import { TagPicker } from "../tag-picker";
import { ListingImageField } from "./listing-image-field";
import {
  LISTING_CATEGORY_OPTIONS,
  LISTING_CHANNEL_OPTIONS,
  PARTIAL_POLICY_OPTIONS,
} from "./listing-form";
import type {
  Currency,
  ListingFormErrors,
  ListingFormField,
  ListingFormValues,
} from "./listing-form";

export interface ListingFormFieldsProps {
  businessId: string;
  values: ListingFormValues;
  errors: ListingFormErrors;
  onChange: (next: ListingFormValues) => void;
  region: "AU" | "ID";
  currency: Currency;
  locations: readonly MerchantLocation[];
  disabled: boolean;
}

/** The listing form's inputs. Amounts stay typed text until `buildNewListingBody` converts them exactly. */
export function ListingFormFields({
  businessId,
  values,
  errors,
  onChange,
  region,
  currency,
  locations,
  disabled,
}: ListingFormFieldsProps) {
  const t = useTranslations("studio");
  const set = <K extends keyof ListingFormValues>(key: K, value: ListingFormValues[K]) =>
    onChange({ ...values, [key]: value });
  const error = (field: ListingFormField) => {
    const key = errors[field];
    return key === undefined ? {} : { errorMessage: t(`inventory.form.error.${key}`) };
  };
  const amountMode = currency === "IDR" ? "numeric" : "decimal";
  // The 1.1.d policy, shown cosmetically: the server re-checks it on save.
  const adultOnly = categoryStatusFor(region, values.contentCategory) === "adult_only";
  const audienceLabels: Record<(typeof AUDIENCES)[number], string> = {
    all_ages: t("campaignBuilder.details.audienceAllAges"),
    teen: t("campaignBuilder.details.audienceTeen"),
    adult: t("campaignBuilder.details.audienceAdult"),
    parents: t("campaignBuilder.details.audienceParents"),
  };

  function changeContentCategory(contentCategory: string) {
    const lock = categoryStatusFor(region, contentCategory) === "adult_only";
    onChange({ ...values, contentCategory, audience: lock ? "adult" : values.audience });
  }

  function toggleLocation(id: string, pressed: boolean) {
    set(
      "locationIds",
      pressed ? [...values.locationIds, id] : values.locationIds.filter((item) => item !== id),
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <Input
        label={t("inventory.form.titleLabel")}
        value={values.title}
        maxLength={140}
        disabled={disabled}
        onChange={(event) => set("title", event.target.value)}
        {...error("title")}
      />
      <Textarea
        label={t("inventory.form.descriptionLabel")}
        value={values.description}
        maxLength={500}
        rows={3}
        disabled={disabled}
        onChange={(event) => set("description", event.target.value)}
        {...error("description")}
      />
      <ListingImageField
        businessId={businessId}
        imageUrl={values.imageUrl}
        disabled={disabled}
        onChange={(imageUrl) => set("imageUrl", imageUrl)}
        {...(errors.imageUrl === undefined
          ? {}
          : { errorMessage: t(`inventory.form.error.${errors.imageUrl}`) })}
      />

      <div className="grid gap-4 sm:grid-cols-2">
        <NativeSelect
          label={t("inventory.form.categoryLabel")}
          value={values.category}
          disabled={disabled}
          onChange={(event) => set("category", event.target.value as ListingFormValues["category"])}
        >
          {LISTING_CATEGORY_OPTIONS.map((value) => (
            <option key={value} value={value}>
              {t(`inventory.form.category.${value}`)}
            </option>
          ))}
        </NativeSelect>
        <NativeSelect
          label={t("campaignBuilder.details.categoryLabel")}
          value={values.contentCategory}
          disabled={disabled}
          onChange={(event) => changeContentCategory(event.target.value)}
        >
          {CONTENT_CATEGORIES.map((value) => {
            const prohibited = categoryStatusFor(region, value) === "prohibited";
            return (
              <option key={value} value={value} disabled={prohibited}>
                {t(`campaignBuilder.details.category.label.${value}`)}
                {prohibited ? t("campaignBuilder.details.categoryOptionProhibitedSuffix") : ""}
              </option>
            );
          })}
        </NativeSelect>
        <NativeSelect
          label={t("campaignBuilder.details.audienceLabel")}
          value={values.audience}
          disabled={disabled || adultOnly}
          onChange={(event) => set("audience", event.target.value)}
        >
          {AUDIENCES.map((audience) => (
            <option key={audience} value={audience}>
              {audienceLabels[audience]}
            </option>
          ))}
        </NativeSelect>
        <NativeSelect
          label={t("inventory.form.channelLabel")}
          value={values.channel}
          disabled={disabled}
          onChange={(event) => set("channel", event.target.value as ListingFormValues["channel"])}
        >
          {LISTING_CHANNEL_OPTIONS.map((channel) => (
            <option key={channel} value={channel}>
              {t(`inventory.row.channel.${channel}`)}
            </option>
          ))}
        </NativeSelect>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <Input
          label={t("inventory.form.faceValueLabel", { currency })}
          helpText={t("inventory.form.faceValueHelp")}
          inputMode={amountMode}
          value={values.faceValue}
          disabled={disabled}
          onChange={(event) => set("faceValue", event.target.value)}
          {...error("faceValue")}
        />
        <Input
          label={t("inventory.form.settlementLabel", { currency })}
          helpText={t("inventory.form.settlementHelp")}
          inputMode={amountMode}
          value={values.settlementValue}
          disabled={disabled}
          onChange={(event) => set("settlementValue", event.target.value)}
          {...error("settlementValue")}
        />
        <Input
          label={t("inventory.form.stockLabel")}
          helpText={t("inventory.form.stockHelp")}
          inputMode="numeric"
          value={values.stockTotal}
          disabled={disabled}
          onChange={(event) => set("stockTotal", event.target.value)}
          {...error("stockTotal")}
        />
        <Input
          label={t("inventory.form.expiresOnLabel")}
          helpText={t("inventory.form.expiresOnHelp")}
          type="date"
          value={values.expiresOn}
          disabled={disabled}
          onChange={(event) => set("expiresOn", event.target.value)}
          {...error("expiresOn")}
        />
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <NativeSelect
          label={t("inventory.form.partialLabel")}
          value={values.partialPolicy}
          disabled={disabled}
          onChange={(event) =>
            set("partialPolicy", event.target.value as ListingFormValues["partialPolicy"])
          }
        >
          {PARTIAL_POLICY_OPTIONS.map((policy) => (
            <option key={policy} value={policy}>
              {t(`inventory.form.partial.${policy}`)}
            </option>
          ))}
        </NativeSelect>
        {values.partialPolicy === "minimum_spend" ? (
          <Input
            label={t("inventory.form.minimumSpendLabel", { currency })}
            inputMode={amountMode}
            value={values.minimumSpend}
            disabled={disabled}
            onChange={(event) => set("minimumSpend", event.target.value)}
            {...error("minimumSpend")}
          />
        ) : null}
      </div>

      <fieldset className="flex flex-col gap-2">
        <legend className="text-label font-sans text-fg">
          {t("inventory.form.locationsLabel")}
        </legend>
        <div className="flex flex-wrap gap-1.5">
          {locations.map((location) => (
            <Chip
              key={location.id}
              pressed={values.locationIds.includes(location.id)}
              disabled={disabled}
              onPressedChange={(pressed) => toggleLocation(location.id, pressed)}
            >
              {location.name}
            </Chip>
          ))}
        </div>
        {errors.locationIds === undefined ? null : (
          <p role="alert" className="text-caption font-sans text-danger-solid">
            {t(`inventory.form.error.${errors.locationIds}`)}
          </p>
        )}
      </fieldset>

      <Switch
        label={t("inventory.transferable")}
        checked={values.transferable}
        disabled={disabled}
        onCheckedChange={(checked) => set("transferable", checked)}
      />
      <p className="-mt-2 text-xs font-sans text-fg-muted">{t("inventory.transferableHelp")}</p>

      <details className="rounded-control border border-border-subtle p-3">
        <summary className="cursor-pointer text-label font-sans text-fg">
          {t("inventory.form.tagsSummary")}
        </summary>
        <div className="mt-3">
          <TagPicker
            value={values.tags}
            onChange={(tags) => set("tags", tags)}
            disabled={disabled}
          />
        </div>
      </details>
    </div>
  );
}
