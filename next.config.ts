import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Keep production validation builds separate from a running local dev server.
  distDir: process.env.PERFI_BUILD_VALIDATION === "1" ? ".next-validation" : ".next",
};

export default nextConfig;
