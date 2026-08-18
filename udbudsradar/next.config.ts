import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    // Route handlers for cron runs may need more than the default budget when a
    // page of notices is large. Vercel enforces the plan limit on top of this.
    serverActions: { bodySizeLimit: "2mb" },
  },
  eslint: { dirs: ["src", "scripts", "tests"] },
};

export default nextConfig;
