"use client";

import { useEffect, useRef } from "react";
import { usePathname } from "next/navigation";
import { onCLS, onINP, onLCP, type Metric } from "web-vitals";
import { useRegion } from "@/features/region/use-region";
import { readEffectiveConnectionType } from "./connection-info";
import { classifyDevice } from "./device-class";
import { buildRumSample } from "./rum-report";
import { sendRumSample } from "./rum-sink";
import type { RumMetricName } from "./rum-budgets";

/** Narrow, ambient DOM types this repo's `lib` target does not include (Device Memory and Network Information are both non-standard extensions — see device-class.ts / connection-info.ts for why they are read defensively either way). */
interface ExtendedNavigator extends Navigator {
  deviceMemory?: number;
  connection?: { effectiveType?: string };
}

/**
 * Field RUM (YT-0501). Mounted once, invisibly, in `app-shell.tsx` — this
 * renders nothing and has no visual presence; it exists purely for its
 * effect. `web-vitals` (Google's own library, the reference implementation
 * every "field INP" number in `docs/08-web-app-and-performance.md` §3.1
 * ultimately depends on) reports LCP, INP and CLS from real interactions on
 * real devices — the thing Lighthouse's lab run structurally cannot do
 * for INP (see `lighthouserc.cjs`'s own comment on that).
 *
 * The `on*` functions register a listener for the page's lifetime with no
 * unsubscribe (see web-vitals' own docs), which matters here because
 * Next's App Router keeps this shell mounted across client-side route
 * changes — it does NOT remount on navigation. So this effect registers
 * the three listeners exactly once (empty dependency array); the current
 * pathname and region are read through a ref that a second, cheap effect
 * keeps current, rather than by re-running the whole registration on every
 * navigation, which would leak one more set of listeners — and one more
 * duplicate report per metric — per route change for the rest of the
 * session.
 *
 * See `rum-sink.ts` for the honest, load-bearing caveat: there is nowhere
 * real to send these samples yet.
 */
export function RumReporter() {
  const pathname = usePathname();
  const { region } = useRegion();
  const latest = useRef({ pathname, region });

  useEffect(() => {
    latest.current = { pathname, region };
  }, [pathname, region]);

  useEffect(() => {
    const nav = typeof navigator === "undefined" ? undefined : (navigator as ExtendedNavigator);
    const deviceClass = classifyDevice(nav?.hardwareConcurrency, nav?.deviceMemory);
    const connectionType = readEffectiveConnectionType(nav?.connection);

    function report(metric: Metric, name: RumMetricName) {
      sendRumSample(
        buildRumSample({
          metric: name,
          value: metric.value,
          country: latest.current.region,
          connectionType,
          deviceClass,
          pathname: latest.current.pathname,
          now: new Date(),
        }),
      );
    }

    onLCP((metric) => report(metric, "LCP"));
    onINP((metric) => report(metric, "INP"));
    onCLS((metric) => report(metric, "CLS"));
    // No cleanup: see the doc comment above — web-vitals offers no
    // unsubscribe, and this effect is deliberately meant to run once.
  }, []);

  return null;
}
