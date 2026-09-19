"use client";

import dynamic from "next/dynamic";

/**
 * `next/dynamic({ ssr: false })` is not allowed directly inside a Server
 * Component (`app-shell.tsx` deliberately stays one — see its own doc
 * comment), so this one-line Client Component is the boundary that makes
 * the dynamic import legal, the same shape `video-player.tsx` uses for
 * `HlsAttacher`/`ResumePrompt` from inside an already-`"use client"` file.
 *
 * This split is not decorative: mounting `RumReporter` directly from
 * `app-shell.tsx` pulled `web-vitals` (~2-3 KB gz) into EVERY `(app)`
 * route's initial JS, because the shell renders on every one of them —
 * `/business/campaigns` measured over the 200 KB hard gate
 * (docs/13b-typescript-standards.md §8) as a direct result, and every
 * other route grew with it. Telemetry that is not needed before the page
 * is interactive has no business being in that measurement at all; this
 * defers it to its own chunk, fetched after hydration, so it costs the
 * budget nothing.
 */
const RumReporter = dynamic(() => import("./rum-reporter").then((mod) => mod.RumReporter), {
  ssr: false,
});

export function RumReporterLoader() {
  return <RumReporter />;
}
