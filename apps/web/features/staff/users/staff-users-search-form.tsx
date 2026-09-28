import { Button } from "@yourtal/ui/button";
import { Input } from "@yourtal/ui/input";
import { NativeSelect } from "@yourtal/ui/native-select";

export interface StaffUsersSearchFormProps {
  readonly t: (key: string) => string;
  readonly defaultEmail: string;
  readonly defaultUserId: string;
  readonly defaultRegion: string;
}

/**
 * TASKS.md 9.4.a. A plain GET form -- no client JS needed, the page itself
 * reads the resulting `?email=&userId=&region=` from `searchParams`.
 */
export function StaffUsersSearchForm({
  t,
  defaultEmail,
  defaultUserId,
  defaultRegion,
}: StaffUsersSearchFormProps) {
  return (
    <form
      method="get"
      className="flex flex-wrap items-end gap-3 rounded-card border border-border-subtle bg-surface p-4"
    >
      <Input
        name="email"
        label={t("users.searchEmail")}
        defaultValue={defaultEmail}
        className="w-64"
      />
      <Input
        name="userId"
        label={t("users.searchUserId")}
        defaultValue={defaultUserId}
        className="w-72"
      />
      <NativeSelect
        name="region"
        label={t("users.searchRegion")}
        defaultValue={defaultRegion}
        className="w-40"
      >
        <option value="">{t("users.anyRegion")}</option>
        <option value="AU">{t("regions.AU")}</option>
        <option value="ID">{t("regions.ID")}</option>
      </NativeSelect>
      <Button type="submit">{t("users.search")}</Button>
    </form>
  );
}
