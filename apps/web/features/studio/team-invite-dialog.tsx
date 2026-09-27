"use client";

import { useId } from "react";
import { useTranslations } from "next-intl";
import { useForm } from "react-hook-form";
import type { BusinessTeamRole } from "@yourtal/contracts/business/team-role";
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
import { NativeSelect } from "@yourtal/ui/native-select";
import { ASSIGNABLE_ROLES, ROLE_LABELS } from "./studio-roles";
import type { TeamActionError } from "./team-errors";
import { teamActionErrorMessage } from "./team-errors";

export interface TeamInviteDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onInvite: (
    email: string,
    role: Exclude<BusinessTeamRole, "owner">,
  ) => TeamActionError | null | Promise<TeamActionError | null>;
}

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

interface InviteFormValues {
  email: string;
  role: Exclude<BusinessTeamRole, "owner">;
}

const DEFAULT_VALUES: InviteFormValues = { email: "", role: "marketer" };

/**
 * Invite-by-email form. `owner` is never an option — see `studio-roles.ts`'s
 * `ASSIGNABLE_ROLES` doc comment.
 *
 * Migrated to React Hook Form (YT-0525): two real, named fields (email,
 * role) with an actual validation rule (email format), which is exactly the
 * shape RHF is for. No Zod schema exists for this two-field dialog and none
 * is added — `register`'s own `required`/`pattern` rules replace the old
 * hand-rolled regex check, matching what this form already checked and
 * nothing more.
 */
export function TeamInviteDialog({ open, onOpenChange, onInvite }: TeamInviteDialogProps) {
  const t = useTranslations("studio");
  const roleSelectId = useId();
  const {
    register,
    handleSubmit,
    reset,
    setError,
    formState: { errors },
  } = useForm<InviteFormValues>({ defaultValues: DEFAULT_VALUES });

  async function submitInvite(values: InviteFormValues) {
    const failure = await onInvite(values.email, values.role);
    if (failure) {
      setError("email", { type: "server", message: teamActionErrorMessage(failure) });
      return;
    }
    reset(DEFAULT_VALUES);
    onOpenChange(false);
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) {
          reset(DEFAULT_VALUES);
        }
        onOpenChange(next);
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("team.invite.title")}</DialogTitle>
          <DialogDescription>{t("team.invite.description")}</DialogDescription>
        </DialogHeader>
        <form
          onSubmit={(event) => void handleSubmit(submitInvite)(event)}
          className="flex flex-col gap-4"
        >
          <Input
            label={t("team.invite.emailLabel")}
            type="email"
            required
            {...register("email", {
              required: t("team.invite.emailInvalid"),
              pattern: { value: EMAIL_PATTERN, message: t("team.invite.emailInvalid") },
            })}
            {...(errors.email?.message ? { errorMessage: errors.email.message } : {})}
          />
          <NativeSelect label={t("team.invite.roleLabel")} id={roleSelectId} {...register("role")}>
            {ASSIGNABLE_ROLES.map((assignableRole) => (
              <option key={assignableRole} value={assignableRole}>
                {ROLE_LABELS[assignableRole]}
              </option>
            ))}
          </NativeSelect>
          <DialogFooter>
            <Button type="button" variant="secondary" onClick={() => onOpenChange(false)}>
              {t("team.cancel")}
            </Button>
            <Button type="submit">{t("team.invite.send")}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
