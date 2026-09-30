"use client";

import { useTranslations } from "next-intl";

/**
 * A category or tag label in the viewer's language: an interest-taxonomy node,
 * else one of the regulated content categories, else the id itself.
 */
export function useCategoryLabel(): (id: string) => string {
  const t = useTranslations("taxonomy");
  return (id) =>
    t.has(`node.${id}`) ? t(`node.${id}`) : t.has(`content.${id}`) ? t(`content.${id}`) : id;
}
