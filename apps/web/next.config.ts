import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: ["@perplog/core", "@perplog/chain"],
  serverExternalPackages: ["@somnia-chain/markets-sdk"],
  cacheComponents: true,
  partialPrefetching: true,
  reactCompiler: true,
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
