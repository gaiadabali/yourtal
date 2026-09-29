import { Button } from "@yourtal/ui/button";
import { NativeSelect } from "@yourtal/ui/native-select";

export interface StaffRiskRegionFormProps {
  readonly t: (key: string) => string;
  readonly defaultRegion: string;
}

/**
 * TASKS.md 10.5.a: `region` is required by `/api/staff/risk/queue` -- each
 * region is its own economy (F2) -- so this is a plain GET form, not an
 * "any region" option like the users search form has.
 */
export function StaffRiskRegionForm({ t, defaultRegion }: StaffRiskRegionFormProps) {
  return (
    <form
      method="get"
      className="flex flex-wrap items-end gap-3 rounded-card border border-border-subtle bg-surface p-4"
    >
      <NativeSelect
        name="region"
        label={t("risk.regionLabel")}
        defaultValue={defaultRegion}
        className="w-40"
      >
        <option value="AU">{t("regions.AU")}</option>
        <option value="ID">{t("regions.ID")}</option>
      </NativeSelect>
      <Button type="submit">{t("risk.viewSubmit")}</Button>
    </form>
  );
}
