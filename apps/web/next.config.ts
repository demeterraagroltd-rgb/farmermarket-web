import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: ["@farmermarket/ui", "@farmermarket/core"],
  images: {
    // CloudFront serves published product/brand images (§4.2); local dev
    // and staging read straight from the S3-compatible MinIO bucket.
    remotePatterns: [
      { protocol: "https", hostname: "*.cloudfront.net" },
      { protocol: "http", hostname: "localhost", port: "9000" },
    ],
  },
};

export default nextConfig;
