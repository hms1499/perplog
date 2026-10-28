import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: ["@perplog/core", "@perplog/chain", "@perplog/db"],
  serverExternalPackages: ["@somnia-chain/markets-sdk"],
  cacheComponents: true,
  partialPrefetching: true,
  reactCompiler: true,
  // The weekly report card reads its fonts from disk; ship them with that route.
  outputFileTracingIncludes: { "/api/og/report/[address]/[week]": ["./assets/fonts/**"] },
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
