"use client";

import { useId } from "react";
import { useTranslations } from "next-intl";
import { Chip } from "@yourtal/ui/chip";
import { INTEREST_TAXONOMY } from "@yourtal/contracts/interest/taxonomy";

/** 13.11.a (F84): the server's own cap (`MAX_TAGS`), restated so this client module stays zod-free. */
export const MAX_TAGS = 8;

interface TaxonomyGroup {
  readonly rootId: string;
  readonly nodeIds: readonly string[];
}

/** Roots as groups, each holding itself and every descendant, in taxonomy order. */
function taxonomyGroups(): TaxonomyGroup[] {
  const rootOf = (id: string): string => {
    let node = INTEREST_TAXONOMY.get(id);
    while (node?.parent != null) node = INTEREST_TAXONOMY.get(node.parent);
    return node?.id ?? id;
  };
  const groups = new Map<string, string[]>();
  for (const node of INTEREST_TAXONOMY.values()) {
    const root = rootOf(node.id);
    groups.set(root, [...(groups.get(root) ?? []), node.id]);
  }
  return [...groups.entries()].map(([rootId, nodeIds]) => ({ rootId, nodeIds }));
}

const GROUPS = taxonomyGroups();

/** Drops anything the taxonomy does not know, e.g. a free-text interest from an older draft. */
export function knownTags(tags: readonly string[]): string[] {
  return [...new Set(tags.filter((tag) => INTEREST_TAXONOMY.has(tag)))].slice(0, MAX_TAGS);
}

export interface TagPickerProps {
  value: readonly string[];
  onChange: (tags: string[]) => void;
  disabled?: boolean | undefined;
}

/**
 * Tags are picked from the interest taxonomy, never typed (F84), so they
 * match what viewers declare. Chips toggle; once 8 are picked, the rest wait.
 */
export function TagPicker({ value, onChange, disabled }: TagPickerProps) {
  const t = useTranslations("studio");
  const tx = useTranslations("taxonomy");
  const countId = useId();
  const selected = knownTags(value);
  const full = selected.length >= MAX_TAGS;

  function toggle(tag: string, pressed: boolean) {
    onChange(pressed ? [...selected, tag] : selected.filter((item) => item !== tag));
  }

  return (
    <fieldset className="flex flex-col gap-3" aria-describedby={countId}>
      <legend className="text-label font-sans text-fg">{t("tags.label")}</legend>
      <p id={countId} className="text-xs font-sans text-fg-muted">
        {selected.length === 0
          ? t("tags.none")
          : t("tags.count", { count: selected.length, max: MAX_TAGS })}
      </p>
      {GROUPS.map((group) => (
        <div key={group.rootId} className="flex flex-col gap-1.5">
          <h4 className="text-xs font-sans font-medium text-fg-muted">
            {tx(`node.${group.rootId}`)}
          </h4>
          <div className="flex flex-wrap gap-1.5">
            {group.nodeIds.map((tag) => {
              const pressed = selected.includes(tag);
              return (
                <Chip
                  key={tag}
                  pressed={pressed}
                  disabled={disabled === true || (full && !pressed)}
                  onPressedChange={(next) => toggle(tag, next)}
                >
                  {tx(`node.${tag}`)}
                </Chip>
              );
            })}
          </div>
        </div>
      ))}
    </fieldset>
  );
}

/** A row's tags as read-only chips, labelled from the taxonomy catalogue. */
export function TagChips({ tags }: { tags: readonly string[] }) {
  const t = useTranslations("studio");
  const tx = useTranslations("taxonomy");
  const known = knownTags(tags);
  if (known.length === 0) return null;
  return (
    <ul className="flex flex-wrap gap-1" aria-label={t("tags.listLabel")}>
      {known.map((tag) => (
        <li key={tag}>
          <Chip variant="static">{tx(`node.${tag}`)}</Chip>
        </li>
      ))}
    </ul>
  );
}
