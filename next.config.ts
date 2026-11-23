import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  turbopack: { root: import.meta.dirname },
  serverExternalPackages: ["better-sqlite3"],
};

export default nextConfig;
