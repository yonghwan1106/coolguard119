import type { NextConfig } from "next";
import path from "path";

const nextConfig: NextConfig = {
  // 다중 lockfile 환경에서 워크스페이스 루트를 이 프로젝트로 고정
  turbopack: {
    root: path.join(__dirname),
  },
  outputFileTracingRoot: path.join(__dirname),
};

export default nextConfig;
