import type { NextConfig } from "next";

const config: NextConfig = {
  reactStrictMode: true,
  // packages/* ship TypeScript source via subpath exports (no barrel files, 13b §5).
  transpilePackages: ["@yourtal/ui", "@yourtal/contracts"],
  typedRoutes: true,
};

export default config;
