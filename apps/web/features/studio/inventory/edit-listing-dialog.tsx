"use client";

import { useState, useTransition } from "react";
import type { SyntheticEvent } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@yourtal/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@yourtal/ui/dialog";
import { Input } from "@yourtal/ui/input";
import { editListingAction } from "./inventory-actions";
import { inventoryErrorKey } from "./inventory-errors";
import { buildListingEditPatch, editValuesFor } from "./listing-edit";
import type { ListingEditErrors, ListingEditOriginal, ListingEditValues } from "./listing-edit";

export interface EditListingDialogProps {
  businessId: string;
  listingId: string;
  original: ListingEditOriginal;
}

/**
 * Edits the three things a listing may change in place: title, stock and the last day to use.
 * There is no price or settlement field: the points price is the platform's, and a change to
 * the settlement value goes through its own dialog (a cut needs a second approver).
 */
export function EditListingDialog({ businessId, listingId, original }: EditListingDialogProps) {
  const t = useTranslations("studio");
  const [open, setOpen] = useState(false);
  const [values, setValues] = useState<ListingEditValues>(() => editValuesFor(original));
  const [errors, setErrors] = useState<ListingEditErrors>({});
  const [unchanged, setUnchanged] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [pending, startTransition] = useTransition();

  function change(next: boolean) {
    setOpen(next);
    // Reopen on what the server holds now, not on an abandoned draft.
    setValues(editValuesFor(original));
    setErrors({});
    setUnchanged(false);
    setFailure(null);
    setSaved(false);
  }

  function set(key: keyof ListingEditValues, value: string) {
    setValues({ ...values, [key]: value });
    setUnchanged(false);
  }

  function error(field: keyof ListingEditValues) {
    const key = errors[field];
    return key === undefined ? {} : { errorMessage: t(`inventory.form.error.${key}`) };
  }

  function submit(event: SyntheticEvent) {
    event.preventDefault();
    const built = buildListingEditPatch(values, original, new Date());
    if (!built.ok) {
      setErrors(built.errors);
      setUnchanged(built.unchanged);
      setFailure(null);
      return;
    }
    setErrors({});
    setFailure(null);
    startTransition(async () => {
      const result = await editListingAction(businessId, listingId, built.patch);
      if (result.ok) setSaved(true);
      else setFailure(t(`inventory.error.${inventoryErrorKey(result.code)}`));
    });
  }

  return (
    <>
      <Button
        type="button"
        variant="secondary"
        size="sm"
        onClick={() => change(true)}
        aria-label={t("inventory.edit.openFor", { title: original.title })}
      >
        {t("inventory.edit.open")}
      </Button>
      <Dialog open={open} onOpenChange={change}>
        <DialogContent closeLabel={t("inventory.cancel")}>
          <DialogHeader>
            <DialogTitle>{t("inventory.edit.title")}</DialogTitle>
            <DialogDescription>
              {t("inventory.edit.description", { title: original.title })}
            </DialogDescription>
          </DialogHeader>
          {saved ? (
            <div className="flex flex-col gap-4">
              <p role="status" className="text-body font-sans text-fg">
                {t("inventory.edit.saved")}
              </p>
              <DialogFooter>
                <Button type="button" onClick={() => change(false)}>
                  {t("inventory.done")}
                </Button>
              </DialogFooter>
            </div>
          ) : (
            <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
              <Input
                label={t("inventory.form.titleLabel")}
                value={values.title}
                maxLength={140}
                disabled={pending}
                onChange={(event) => set("title", event.target.value)}
                {...error("title")}
              />
              <Input
                label={t("inventory.form.stockLabel")}
                helpText={t("inventory.edit.stockHelp")}
                inputMode="numeric"
                value={values.stockTotal}
                disabled={pending}
                onChange={(event) => set("stockTotal", event.target.value)}
                {...error("stockTotal")}
              />
              <Input
                label={t("inventory.form.expiresOnLabel")}
                helpText={t("inventory.form.expiresOnHelp")}
                type="date"
                value={values.expiresOn}
                disabled={pending}
                onChange={(event) => set("expiresOn", event.target.value)}
                {...error("expiresOn")}
              />
              {unchanged || failure !== null ? (
                <p role="alert" className="text-body-sm font-sans text-danger-solid">
                  {failure ?? t("inventory.edit.unchanged")}
                </p>
              ) : null}
              <DialogFooter>
                <Button type="button" variant="secondary" onClick={() => change(false)}>
                  {t("inventory.cancel")}
                </Button>
                <Button type="submit" disabled={pending}>
                  {pending ? t("inventory.edit.saving") : t("inventory.edit.save")}
                </Button>
              </DialogFooter>
            </form>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
