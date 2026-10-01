"use client";

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@yourtal/ui/button";
import { NativeSelect } from "@yourtal/ui/native-select";
import { Switch } from "@yourtal/ui/switch";
import { CONTENT_CATEGORIES } from "../campaign-builder/campaign-editor-details";
import { TagPicker, knownTags } from "../tag-picker";
import { updateListingTags } from "./inventory-actions";

export interface ListingTagsEditorProps {
  businessId: string;
  listingId: string;
  listingTitle: string;
  contentCategory: string;
  tags: readonly string[];
  transferable: boolean;
}

/**
 * 13.11.a: a listing's primary category and up to 8 taxonomy tags, saved over
 * the real PATCH. The server re-checks the category policy; its refusal is
 * shown here as it comes back.
 */
export function ListingTagsEditor(props: ListingTagsEditorProps) {
  const t = useTranslations("studio");
  const [open, setOpen] = useState(false);
  const [category, setCategory] = useState(props.contentCategory);
  const [tags, setTags] = useState<string[]>(knownTags(props.tags));
  const [transferable, setTransferable] = useState(props.transferable);
  const [message, setMessage] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  const [pending, startTransition] = useTransition();

  function save() {
    setMessage(null);
    startTransition(async () => {
      const result = await updateListingTags(props.businessId, props.listingId, {
        contentCategory: category,
        tags,
        transferable,
      });
      setMessage(
        result.ok
          ? { tone: "ok", text: t("inventory.tagsSaved") }
          : { tone: "error", text: result.message },
      );
    });
  }

  if (!open) {
    return (
      <Button
        type="button"
        variant="secondary"
        size="sm"
        onClick={() => setOpen(true)}
        aria-label={t("inventory.editTagsFor", { title: props.listingTitle })}
      >
        {t("inventory.editTags")}
      </Button>
    );
  }

  return (
    <div className="flex w-full flex-col gap-4 rounded-control border border-border-subtle p-3">
      <NativeSelect
        label={t("campaignBuilder.details.categoryLabel")}
        value={category}
        disabled={pending}
        onChange={(event) => setCategory(event.target.value)}
      >
        {CONTENT_CATEGORIES.map((value) => (
          <option key={value} value={value}>
            {t(`campaignBuilder.details.category.label.${value}`)}
          </option>
        ))}
      </NativeSelect>
      <TagPicker value={tags} onChange={setTags} disabled={pending} />
      <Switch
        label={t("inventory.transferable")}
        checked={transferable}
        disabled={pending}
        onCheckedChange={setTransferable}
      />
      <p className="-mt-2 text-xs font-sans text-fg-muted">{t("inventory.transferableHelp")}</p>
      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" size="sm" onClick={save} disabled={pending}>
          {t("inventory.saveTags")}
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => setOpen(false)}
          disabled={pending}
        >
          {t("inventory.closeTags")}
        </Button>
        {message === null ? null : (
          <p
            role={message.tone === "error" ? "alert" : "status"}
            className={
              message.tone === "error"
                ? "text-body-sm font-sans text-danger-solid"
                : "text-body-sm font-sans text-fg-muted"
            }
          >
            {message.text}
          </p>
        )}
      </div>
    </div>
  );
}
