"use client";

import dynamic from "next/dynamic";

// Shown to few viewers, once: split out of every (app) page's first load (the 200 KB gate).
// Must live in a Client Component; a Server Component's dynamic import is not code-split.
export const GodNoticePrompt = dynamic(() =>
  import("./god-notice-prompt").then((m) => m.GodNoticePrompt),
);
