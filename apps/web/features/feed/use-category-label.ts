"use client";

import { useTranslations } from "next-intl";

/** A taxonomy node's label in the viewer's language; the id itself if a node has none yet. */
export function useCategoryLabel(): (id: string) => string {
  const t = useTranslations("taxonomy.node");
  return (id) => (t.has(id) ? t(id) : id);
}
