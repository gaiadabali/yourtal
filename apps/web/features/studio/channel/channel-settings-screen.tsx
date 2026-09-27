import type { Business } from "@yourtal/contracts/business";
import { Button } from "@yourtal/ui/button";
import { Input } from "@yourtal/ui/input";
import { Card, CardContent } from "@yourtal/ui/card";
import { getStudioTranslator } from "../studio-i18n";
import { updateChannelAction } from "./update-channel-action";

export interface ChannelSettingsScreenProps {
  business: Business;
  saved: boolean;
  errorField: string | null;
}

/** Channel settings (task 7.8.b): logo, cover and handle. */
export function ChannelSettingsScreen({ business, saved, errorField }: ChannelSettingsScreenProps) {
  const t = getStudioTranslator();
  const errorMessages: Record<string, string> = {
    invalid_input: t("channel.error.invalidInput"),
    save_failed: t("channel.error.saveFailed"),
  };

  return (
    <Card>
      <CardContent className="flex flex-col gap-4 p-6">
        {saved ? (
          <p className="text-body-sm text-success-solid" role="status">
            {t("channel.saved")}
          </p>
        ) : null}
        {errorField ? (
          <p className="text-body-sm text-danger-solid" role="alert">
            {errorMessages[errorField] ?? t("channel.error.default")}
          </p>
        ) : null}
        <form action={updateChannelAction} className="flex flex-col gap-4">
          <input type="hidden" name="businessId" value={business.id} />
          <Input
            name="displayName"
            label={t("channel.displayNameLabel")}
            required
            defaultValue={business.displayName}
          />
          <Input
            name="handle"
            label={t("channel.handleLabel")}
            required
            defaultValue={business.handle}
            helpText={t("channel.handleHelp")}
          />
          <Input
            name="logoUrl"
            label={t("channel.logoUrlLabel")}
            type="url"
            defaultValue={business.logoUrl ?? ""}
            helpText={t("channel.logoUrlHelp")}
          />
          <Input
            name="coverUrl"
            label={t("channel.coverUrlLabel")}
            type="url"
            defaultValue={business.coverUrl ?? ""}
          />
          <Button type="submit" className="w-fit">
            {t("channel.save")}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
