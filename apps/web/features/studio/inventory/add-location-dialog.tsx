"use client";

import { useState, useTransition } from "react";
import type { FormEvent } from "react";
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
import { createLocationAction } from "./inventory-actions";
import { inventoryErrorKey } from "./inventory-errors";

const EMPTY = { name: "", address: "", district: "" };

/** `POST .../store/locations`: one outlet a listing can be redeemed at. */
export function AddLocationDialog({ businessId }: { businessId: string }) {
  const t = useTranslations("studio");
  const [open, setOpen] = useState(false);
  const [values, setValues] = useState(EMPTY);
  const [error, setError] = useState<string | null>(null);
  const [added, setAdded] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function change(next: boolean) {
    setOpen(next);
    if (!next) {
      setValues(EMPTY);
      setError(null);
      setAdded(null);
    }
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    const input = {
      name: values.name.trim(),
      address: values.address.trim(),
      district: values.district.trim(),
    };
    if (input.name === "" || input.address === "" || input.district === "") {
      setError(t("inventory.form.error.required"));
      return;
    }
    setError(null);
    startTransition(async () => {
      const result = await createLocationAction(businessId, input);
      if (result.ok) setAdded(result.value.name);
      else setError(t(`inventory.error.${inventoryErrorKey(result.code)}`));
    });
  }

  return (
    <>
      <Button type="button" variant="secondary" size="sm" onClick={() => change(true)}>
        {t("inventory.addLocation")}
      </Button>
      <Dialog open={open} onOpenChange={change}>
        <DialogContent closeLabel={t("inventory.cancel")}>
          <DialogHeader>
            <DialogTitle>{t("inventory.location.title")}</DialogTitle>
            <DialogDescription>{t("inventory.location.description")}</DialogDescription>
          </DialogHeader>
          {added === null ? (
            <form onSubmit={submit} className="flex flex-col gap-4">
              <Input
                label={t("inventory.location.nameLabel")}
                value={values.name}
                maxLength={120}
                required
                disabled={pending}
                onChange={(event) => setValues({ ...values, name: event.target.value })}
              />
              <Input
                label={t("inventory.location.addressLabel")}
                value={values.address}
                maxLength={200}
                required
                disabled={pending}
                onChange={(event) => setValues({ ...values, address: event.target.value })}
              />
              <Input
                label={t("inventory.location.districtLabel")}
                value={values.district}
                maxLength={60}
                required
                disabled={pending}
                onChange={(event) => setValues({ ...values, district: event.target.value })}
              />
              {error === null ? null : (
                <p role="alert" className="text-body-sm font-sans text-danger-solid">
                  {error}
                </p>
              )}
              <DialogFooter>
                <Button type="button" variant="secondary" onClick={() => change(false)}>
                  {t("inventory.cancel")}
                </Button>
                <Button type="submit" disabled={pending}>
                  {pending ? t("inventory.location.saving") : t("inventory.location.save")}
                </Button>
              </DialogFooter>
            </form>
          ) : (
            <div className="flex flex-col gap-4">
              <p role="status" className="text-body font-sans text-fg">
                {t("inventory.location.added", { name: added })}
              </p>
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
