/**
 * The GOD Group Privacy Notice's id, version and links (god/TASKS.md 9.1).
 * Kept free of imports so client components can show the notice link
 * without pulling zod into every page's first load.
 */
export const GOD_GROUP_NOTICE = {
  id: "god-group-notice",
  version: "1.1",
  effectiveFrom: "2026-11-27",
  url: "https://god.gaiada.com/privacy-notice/",
  teensUrl: "https://god.gaiada.com/privacy-notice/#teens",
} as const;
