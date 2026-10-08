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
import { Textarea } from "@yourtal/ui/textarea";
import { requestVoucherBatchAction } from "./inventory-actions";
import { inventoryErrorKey } from "./inventory-errors";
import { buildVoucherRequestBody } from "./voucher-request";
import type { VoucherRequestErrorKey } from "./voucher-request";

export interface VoucherRequestDialogProps {
  businessId: string;
  listingId: string;
  listingTitle: string;
  stockTotal: number;
  /** Stock not yet asked for (`requestableStock`); the request cannot exceed it. */
  requestable: number;
}

/**
 * Asks YourTal to issue vouchers for a listing. The request is stock only (no price), and a
 * reviewer approves it before anything is minted, so the dialog ends by saying it is waiting.
 */
export function VoucherRequestDialog(props: VoucherRequestDialogProps) {
  const t = useTranslations("studio");
  const [open, setOpen] = useState(false);
  const [quantity, setQuantity] = useState("");
  const [reason, setReason] = useState("");
  const [fieldError, setFieldError] = useState<VoucherRequestErrorKey | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [sent, setSent] = useState<number | null>(null);
  const [pending, startTransition] = useTransition();

  function change(next: boolean) {
    setOpen(next);
    if (!next) {
      setQuantity("");
      setReason("");
      setFieldError(null);
      setFailure(null);
      setSent(null);
    }
  }

  function submit(event: SyntheticEvent) {
    event.preventDefault();
    const built = buildVoucherRequestBody({ quantity, reason }, props.requestable);
    if (!built.ok) {
      setFieldError(built.error);
      setFailure(null);
      return;
    }
    setFieldError(null);
    setFailure(null);
    startTransition(async () => {
      const result = await requestVoucherBatchAction(props.businessId, props.listingId, built.body);
      if (result.ok) setSent(result.value.quantity);
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
        aria-label={t("inventory.voucherRequest.openFor", { title: props.listingTitle })}
      >
        {t("inventory.voucherRequest.open")}
      </Button>
      <Dialog open={open} onOpenChange={change}>
        <DialogContent closeLabel={t("inventory.cancel")}>
          <DialogHeader>
            <DialogTitle>{t("inventory.voucherRequest.title")}</DialogTitle>
            <DialogDescription>
              {t("inventory.voucherRequest.description", { title: props.listingTitle })}
            </DialogDescription>
          </DialogHeader>
          {sent === null ? (
            <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
              <Input
                label={t("inventory.voucherRequest.quantityLabel")}
                helpText={t("inventory.voucherRequest.quantityHelp", {
                  requestable: props.requestable,
                  total: props.stockTotal,
                })}
                inputMode="numeric"
                value={quantity}
                disabled={pending}
                onChange={(event) => setQuantity(event.target.value)}
                {...(fieldError === null
                  ? {}
                  : {
                      errorMessage: t(`inventory.voucherRequest.error.${fieldError}`, {
                        requestable: props.requestable,
                      }),
                    })}
              />
              <Textarea
                label={t("inventory.voucherRequest.reasonLabel")}
                value={reason}
                rows={2}
                maxLength={500}
                disabled={pending}
                onChange={(event) => setReason(event.target.value)}
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
                  {pending
                    ? t("inventory.voucherRequest.sending")
                    : t("inventory.voucherRequest.submit")}
                </Button>
              </DialogFooter>
            </form>
          ) : (
            <div className="flex flex-col gap-4">
              <p role="status" className="text-body font-sans text-fg">
                {t("inventory.voucherRequest.sent", { quantity: sent })}
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
