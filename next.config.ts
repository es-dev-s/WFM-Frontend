import type { NextConfig } from "next";

const API_ORIGIN = process.env.API_ORIGIN ?? "http://127.0.0.1:18780";

const nextConfig: NextConfig = {
  // Tree-shake lucide icons — critical when many modules import from the package
  experimental: {
    optimizePackageImports: ["lucide-react"],
  },
  async rewrites() {
    return [
      {
        source: "/api/v1/:path*",
        destination: `${API_ORIGIN}/api/v1/:path*`,
      },
    ];
  },
  async redirects() {
    return [
      { source: "/calendar", destination: "/", permanent: false },
      { source: "/classes", destination: "/biomatic", permanent: false },
      { source: "/attendance", destination: "/tivazo", permanent: false },
      { source: "/assessments", destination: "/", permanent: false },
      { source: "/directory", destination: "/biomatic", permanent: false },
      { source: "/finance", destination: "/", permanent: false },
    ];
  },
};

export default nextConfig;
