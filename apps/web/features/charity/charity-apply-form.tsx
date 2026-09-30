"use client";

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import type { CharityApplicationRequest, CharityCause } from "@yourtal/contracts/charity";
import { Button } from "@yourtal/ui/button";
import { Input } from "@yourtal/ui/input";
import { NativeSelect } from "@yourtal/ui/native-select";
import { Switch } from "@yourtal/ui/switch";
import { Textarea } from "@yourtal/ui/textarea";
import { applyForCharity } from "./charity-actions";

/** Restated from the contract so this client module stays zod-free. */
const CAUSES: readonly CharityCause[] = [
  "children_youth",
  "education",
  "environment",
  "animals",
  "disaster_relief",
  "community",
  "arts_culture",
  "food_security",
];
const KNOWN_ERRORS = new Set(["kyb_abn_invalid", "kyb_account_refused", "forbidden"]);

/**
 * 13.21.a: `/charity/apply`. The region is the applicant's own, so the form
 * asks AU applicants for an ABN and ACNC registration and ID applicants for a
 * yayasan deed and fundraising permit. The server runs the check.
 */
export function CharityApplyForm({ region }: { region: "AU" | "ID" }) {
  const t = useTranslations("charity");
  const router = useRouter();
  const [values, setValues] = useState({
    name: "",
    cause: "children_youth" as CharityCause,
    summary: "",
    abn: "",
    acnc: false,
    deed: "",
    permit: "",
    accountName: "",
    bankCode: "",
    accountNumber: "",
  });
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [pending, startTransition] = useTransition();
  const set = (key: keyof typeof values) => (value: string | boolean) =>
    setValues((current) => ({ ...current, [key]: value }));

  function submit(event: React.SyntheticEvent) {
    event.preventDefault();
    setError(null);
    const application: CharityApplicationRequest = {
      name: values.name.trim(),
      region,
      cause: values.cause,
      summary: values.summary.trim(),
      logoUrl: null,
      registration:
        region === "AU"
          ? { kind: "au_acnc", abn: values.abn.replace(/\s/g, ""), acncRegistered: true }
          : {
              kind: "id_yayasan",
              deedNumber: values.deed.trim(),
              fundraisingPermitNumber: values.permit.trim(),
            },
      payoutAccount: {
        accountName: values.accountName.trim(),
        bankCode: values.bankCode.replace(/\D/g, ""),
        accountNumber: values.accountNumber.replace(/\D/g, ""),
      },
    };
    if (region === "AU" && !values.acnc) {
      setError(t("apply.errors.generic"));
      return;
    }
    startTransition(async () => {
      const result = await applyForCharity(application);
      if (result.ok) {
        setDone(true);
        router.refresh();
        return;
      }
      const code = result.code ?? "";
      setError(t(`apply.errors.${KNOWN_ERRORS.has(code) ? code : "generic"}`));
    });
  }

  if (done) {
    return (
      <p role="status" className="font-sans text-body text-fg">
        {t("apply.submitted")}
      </p>
    );
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
      <Input
        label={t("apply.name")}
        value={values.name}
        required
        onChange={(e) => set("name")(e.target.value)}
      />
      <NativeSelect
        label={t("apply.cause")}
        value={values.cause}
        onChange={(e) => set("cause")(e.target.value)}
      >
        {CAUSES.map((cause) => (
          <option key={cause} value={cause}>
            {t(`cause.${cause}`)}
          </option>
        ))}
      </NativeSelect>
      <Textarea
        label={t("apply.summary")}
        value={values.summary}
        onChange={(e) => set("summary")(e.target.value)}
      />
      {region === "AU" ? (
        <>
          <Input
            label={t("apply.abn")}
            inputMode="numeric"
            value={values.abn}
            onChange={(e) => set("abn")(e.target.value)}
          />
          <Switch label={t("apply.acnc")} checked={values.acnc} onCheckedChange={set("acnc")} />
        </>
      ) : (
        <>
          <Input
            label={t("apply.deed")}
            value={values.deed}
            onChange={(e) => set("deed")(e.target.value)}
          />
          <Input
            label={t("apply.permit")}
            value={values.permit}
            onChange={(e) => set("permit")(e.target.value)}
          />
        </>
      )}
      <Input
        label={t("apply.accountName")}
        value={values.accountName}
        onChange={(e) => set("accountName")(e.target.value)}
      />
      <div className="grid gap-4 sm:grid-cols-2">
        <Input
          label={region === "AU" ? t("apply.bankCodeAU") : t("apply.bankCodeID")}
          inputMode="numeric"
          value={values.bankCode}
          onChange={(e) => set("bankCode")(e.target.value)}
        />
        <Input
          label={t("apply.accountNumber")}
          inputMode="numeric"
          helpText={t("apply.accountNote")}
          value={values.accountNumber}
          onChange={(e) => set("accountNumber")(e.target.value)}
        />
      </div>
      {error === null ? null : (
        <p role="alert" className="font-sans text-body-sm text-danger-solid">
          {error}
        </p>
      )}
      <Button type="submit" disabled={pending} className="self-start">
        {t("apply.submit")}
      </Button>
    </form>
  );
}
