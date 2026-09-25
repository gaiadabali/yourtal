import createBundleAnalyzer from "@next/bundle-analyzer";
import createNextIntlPlugin from "next-intl/plugin";
import withSerwistInit from "@serwist/next";
import type { NextConfig } from "next";

const config: NextConfig = {
  reactStrictMode: true,
  // packages/* ship TypeScript source via subpath exports (no barrel files, 13b §5).
  transpilePackages: ["@yourtal/ui", "@yourtal/contracts"],
  typedRoutes: true,
  // `(lab)` prototypes and the primitive gallery use `.lab.tsx`, so they are routes
  // only in a YOURTAL_LAB=1 build and never in the one that ships.
  pageExtensions: process.env["YOURTAL_LAB"] === "1" ? ["tsx", "ts", "lab.tsx"] : ["tsx", "ts"],
  // Self-contained server bundle for deployment (YT-0532, decision S-1).
  //
  // Required, not a preference: this is a pnpm WORKSPACE, so node_modules is a
  // tree of symlinks into a content-addressed store. A tarball of it does not
  // survive being moved to another machine, and the deploy artifact has to.
  // `standalone` emits .next/standalone with a server.js and only the files
  // actually reached. It is NOT flat — it keeps a .pnpm tree with 26 internal
  // symlinks — but measured 2026-09-20, none of them point outside the
  // bundle, so tar preserves them and they resolve after extraction. That is
  // the property that matters, and it is the one to re-check if a future
  // pnpm or Next version changes how the trace is laid out.
  //
  // It also keeps the artifact small enough that the checksum-verified
  // download gaiada-deploy performs stays quick.
  output: "standalone",
  // i18n/request.ts reads the catalogues from disk, which the tracer cannot see.
  outputFileTracingIncludes: { "/**": ["./messages/**/*.json"] },
};

// Bundle-analyzer report for YT-0404 (perf budget harness). Opt-in only —
// `pnpm --filter @yourtal/web analyze` sets ANALYZE=true, everyday `next build`
// / `next dev` is unaffected. The build-time 170 KB gz gate itself lives in
// scripts/perf-check-bundle-size.mjs, which reads Next's own
// .next/diagnostics/route-bundle-stats.json rather than this HTML report.
const withBundleAnalyzer = createBundleAnalyzer({
  enabled: process.env["ANALYZE"] === "true",
});

// docs/15-stack-locked.md line 28 locks next-intl for `id-ID`/`en-AU`
// (YT-0405). `./i18n/request.ts` resolves the active locale from the same
// region cookie `apps/web/features/region` already reads — see that file's
// doc comment for why it does not use next-intl's own URL-based routing.
const withNextIntl = createNextIntlPlugin("./i18n/request.ts");

// docs/15-stack-locked.md's Serwist lock (YT-0424: "renders from cache with
// the network disabled"). `app/sw.ts` has the full scoping rationale —
// this wires it into the build: `register: true` (the default) injects the
// `navigator.serviceWorker.register("/sw.js")` call itself, so no separate
// registration component is needed anywhere in the app tree.
const withSerwist = withSerwistInit({
  swSrc: "app/sw.ts",
  swDest: "public/sw.js",
});

export default withSerwist(withNextIntl(withBundleAnalyzer(config)));
