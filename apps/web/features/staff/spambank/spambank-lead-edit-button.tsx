"use client";

import { useId, useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@yourtal/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@yourtal/ui/dialog";
import { NativeSelect } from "@yourtal/ui/native-select";
import { Notice } from "@yourtal/ui/notice";
import { Textarea } from "@yourtal/ui/textarea";
import { LEAD_STATUSES, type LeadStatus, type SpambankLead } from "./spambank-staff-contract";
import { updateLeadAction } from "./spambank-staff-actions";

export interface SpambankLeadEditButtonProps {
  readonly lead: SpambankLead;
  readonly onSaved: (orgDomain: string, status: LeadStatus, note: string | null) => void;
}

/** BUILD.md 4.7: the sales team's status and note for one brand (`ops` only; the button is a courtesy, the API enforces). */
export function SpambankLeadEditButton({ lead, onSaved }: SpambankLeadEditButtonProps) {
  const t = useTranslations("staff.spambank.leads");
  const tc = useTranslations("staff");
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState<LeadStatus>(lead.status);
  const [note, setNote] = useState(lead.note ?? "");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const statusId = useId();
  const noteId = useId();

  function save() {
    startTransition(() => {
      void updateLeadAction(lead.orgDomain, status, note).then((result) => {
        if (result.ok) {
          const trimmed = note.trim();
          onSaved(lead.orgDomain, status, trimmed === "" ? null : trimmed);
          setError(null);
          setOpen(false);
        } else {
          setError(tc("errors.actionFailed"));
        }
      });
    });
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) {
          setStatus(lead.status);
          setNote(lead.note ?? "");
          setError(null);
        }
      }}
    >
      <DialogTrigger asChild>
        <Button variant="secondary" aria-label={t("editAria", { domain: lead.orgDomain })}>
          {t("edit")}
        </Button>
      </DialogTrigger>
      <DialogContent closeLabel={tc("dialog.close")}>
        <DialogHeader>
          <DialogTitle className="font-semibold">
            {t("editTitle", { domain: lead.orgDomain })}
          </DialogTitle>
        </DialogHeader>
        {error === null ? null : <Notice tone="danger">{error}</Notice>}
        <NativeSelect
          id={statusId}
          label={t("statusLabel")}
          value={status}
          onChange={(event) => setStatus(event.target.value as LeadStatus)}
        >
          {LEAD_STATUSES.map((value) => (
            <option key={value} value={value}>
              {t(`status.${value}`)}
            </option>
          ))}
        </NativeSelect>
        <Textarea
          id={noteId}
          label={t("noteLabel")}
          value={note}
          maxLength={2000}
          onChange={(event) => setNote(event.target.value)}
        />
        <DialogFooter>
          <Button variant="ghost" onClick={() => setOpen(false)} disabled={pending}>
            {tc("dialog.cancel")}
          </Button>
          <Button onClick={save} loading={pending}>
            {t("save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
