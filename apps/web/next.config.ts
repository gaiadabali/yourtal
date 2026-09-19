import createBundleAnalyzer from "@next/bundle-analyzer";
import type { NextConfig } from "next";

const config: NextConfig = {
  reactStrictMode: true,
  // packages/* ship TypeScript source via subpath exports (no barrel files, 13b §5).
  transpilePackages: ["@yourtal/ui", "@yourtal/contracts"],
  typedRoutes: true,
};

// Bundle-analyzer report for YT-0404 (perf budget harness). Opt-in only —
// `pnpm --filter @yourtal/web analyze` sets ANALYZE=true, everyday `next build`
// / `next dev` is unaffected. The build-time 170 KB gz gate itself lives in
// scripts/perf-check-bundle-size.mjs, which reads Next's own
// .next/diagnostics/route-bundle-stats.json rather than this HTML report.
const withBundleAnalyzer = createBundleAnalyzer({
  enabled: process.env["ANALYZE"] === "true",
});

export default withBundleAnalyzer(config);
