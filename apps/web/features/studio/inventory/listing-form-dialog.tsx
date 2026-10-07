"use client";

import { useState, useTransition } from "react";
import type { SyntheticEvent } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Button } from "@yourtal/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@yourtal/ui/dialog";
import { PointsChip } from "@yourtal/ui/points-chip";
import type { MerchantLocation } from "@yourtal/contracts/listing/merchant-location";
import { createListingAction } from "./inventory-actions";
import type { PricedListing } from "./inventory-actions";
import { inventoryErrorKey } from "./inventory-errors";
import { ListingFormFields } from "./listing-form-fields";
import { buildNewListingBody, emptyListingValues } from "./listing-form";
import type { Currency, ListingFormErrors, ListingFormValues } from "./listing-form";

export interface ListingFormDialogProps {
  businessId: string;
  merchantName: string;
  region: "AU" | "ID";
  currency: Currency;
  locations: readonly MerchantLocation[];
}

/**
 * Creates a listing. The form has no price field: after saving, the dialog shows
 * the points price the platform computed from the settlement value.
 */
export function ListingFormDialog(props: ListingFormDialogProps) {
  const t = useTranslations("studio");
  const locale = useLocale();
  const [open, setOpen] = useState(false);
  const [values, setValues] = useState<ListingFormValues>(emptyListingValues);
  const [errors, setErrors] = useState<ListingFormErrors>({});
  const [failure, setFailure] = useState<string | null>(null);
  const [created, setCreated] = useState<PricedListing | null>(null);
  const [pending, startTransition] = useTransition();
  const noLocations = props.locations.length === 0;

  function change(next: boolean) {
    setOpen(next);
    if (!next) {
      setValues(emptyListingValues());
      setErrors({});
      setFailure(null);
      setCreated(null);
    }
  }

  function submit(event: SyntheticEvent) {
    event.preventDefault();
    const built = buildNewListingBody(values, {
      currency: props.currency,
      merchantName: props.merchantName,
      now: new Date(),
    });
    if (!built.ok) {
      setErrors(built.errors);
      setFailure(null);
      return;
    }
    setErrors({});
    setFailure(null);
    startTransition(async () => {
      const result = await createListingAction(props.businessId, built.body);
      if (result.ok) setCreated(result.value);
      else setFailure(t(`inventory.error.${inventoryErrorKey(result.code)}`));
    });
  }

  return (
    <>
      <div className="flex flex-col items-start gap-1">
        <Button type="button" size="sm" disabled={noLocations} onClick={() => change(true)}>
          {t("inventory.newListing")}
        </Button>
        {noLocations ? (
          <p className="text-caption font-sans text-fg-muted">{t("inventory.needLocationFirst")}</p>
        ) : null}
      </div>
      <Dialog open={open} onOpenChange={change}>
        <DialogContent
          closeLabel={t("inventory.cancel")}
          className="max-h-[90dvh] max-w-2xl overflow-y-auto"
        >
          <DialogHeader>
            <DialogTitle>{t("inventory.form.title")}</DialogTitle>
            <DialogDescription>{t("inventory.form.description")}</DialogDescription>
          </DialogHeader>
          {created === null ? (
            <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
              <ListingFormFields
                values={values}
                errors={errors}
                onChange={setValues}
                region={props.region}
                currency={props.currency}
                locations={props.locations}
                disabled={pending}
              />
              {failure === null ? null : (
                <p role="alert" className="text-body-sm font-sans text-danger-solid">
                  {failure}
                </p>
              )}
              <DialogFooter>
                <Button type="button" variant="secondary" onClick={() => change(false)}>
                  {t("inventory.cancel")}
                </Button>
                <Button type="submit" disabled={pending}>
                  {pending ? t("inventory.form.submitting") : t("inventory.form.submit")}
                </Button>
              </DialogFooter>
            </form>
          ) : (
            <div className="flex flex-col gap-4">
              <p role="status" className="text-body font-sans text-fg">
                {t("inventory.form.created")}
              </p>
              <div className="flex flex-wrap items-center gap-2 text-body-sm font-sans text-fg">
                <span>{t("inventory.form.createdPrice", { title: created.title })}</span>
                <PointsChip
                  value={created.priceInPoints}
                  locale={locale}
                  formatLabel={(formatted) => t("billing.points", { formatted })}
                />
              </div>
              <DialogFooter>
                <Button type="button" onClick={() => change(false)}>
                  {t("inventory.done")}
                </Button>
              </DialogFooter>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
