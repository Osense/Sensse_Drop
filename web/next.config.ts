import type { NextConfig } from "next";

/**
 * 정적 export(out/)를 Cloudflare Worker 정적 자산으로 올립니다 (../wrangler.jsonc).
 * /api/* 와 /s/<링크> 는 Worker(../worker/src/index.ts)가 먼저 받습니다.
 */
const nextConfig: NextConfig = {
  output: "export",
  trailingSlash: true,
  images: { unoptimized: true },
  reactStrictMode: true,
  poweredByHeader: false,
};

export default nextConfig;
