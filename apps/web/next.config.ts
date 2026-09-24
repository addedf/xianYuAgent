import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  images: {
    remotePatterns: [{ protocol: "https", hostname: "img.alicdn.com" }],
    unoptimized: true,
  },
};

export default nextConfig;
