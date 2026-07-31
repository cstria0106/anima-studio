import type { NextConfig } from "next";
import { PHASE_DEVELOPMENT_SERVER } from "next/constants";

const baseConfig: NextConfig = {
  output: "export",
  devIndicators: false,
  reactStrictMode: true,
  poweredByHeader: false,
  images: {
    unoptimized: true,
    remotePatterns: [
      { protocol: "https", hostname: "image.civitai.com" },
      { protocol: "https", hostname: "image.civitai.red" },
    ],
  },
};

export default function nextConfig(phase: string): NextConfig {
  return {
    ...baseConfig,
    ...(phase === PHASE_DEVELOPMENT_SERVER
      ? {
          async rewrites() {
            return [
              {
                source: "/api/:path*",
                destination: "http://127.0.0.1:8787/api/:path*",
              },
            ];
          },
        }
      : {}),
  };
}
