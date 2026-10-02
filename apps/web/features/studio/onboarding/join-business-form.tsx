import { Button } from "@yourtal/ui/button";
import { Card, CardContent } from "@yourtal/ui/card";
import { Input } from "@yourtal/ui/input";
import { getStudioTranslator, type SupportedLocale } from "../studio-i18n";
import { acceptInvitationAction } from "./accept-invitation-action";

export interface JoinBusinessFormProps {
  token: string;
  failed: boolean;
  locale: SupportedLocale;
}

/** A plain server-action form: the invitee pastes the code from their invitation email. */
export function JoinBusinessForm({ token, failed, locale }: JoinBusinessFormProps) {
  const t = getStudioTranslator(locale);
  return (
    <Card>
      <CardContent className="flex flex-col gap-4 p-6">
        {failed ? (
          <p className="text-body-sm text-danger-solid" role="alert">
            {t("join.error")}
          </p>
        ) : null}
        <form action={acceptInvitationAction} className="flex flex-col gap-4">
          <Input
            name="token"
            label={t("join.codeLabel")}
            helpText={t("join.codeHelp")}
            required
            defaultValue={token}
            autoComplete="off"
          />
          <Button type="submit" className="w-fit">
            {t("join.submit")}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
