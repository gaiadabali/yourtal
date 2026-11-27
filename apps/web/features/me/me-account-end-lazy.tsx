"use client";

import dynamic from "next/dynamic";

// The last two sections on /me, used once in a long while: split out of the first load, which sits at
// the 200 KB gate. Must live in a Client Component; a Server Component's dynamic import is not code-split.
export const MeDataExportSection = dynamic(() =>
  import("./me-data-export-section").then((m) => m.MeDataExportSection),
);

export const MeDeleteAccountSection = dynamic(() =>
  import("./me-delete-account-section").then((m) => m.MeDeleteAccountSection),
);
