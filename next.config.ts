import os from "node:os";
import type { NextConfig } from "next";

function lanDevOrigins(): string[] {
  const origins = new Set<string>(["localhost", "127.0.0.1"]);
  const hostname = os.hostname().trim();
  if (hostname) {
    origins.add(hostname);
    origins.add(`${hostname}.local`);
  }
  for (const extra of (process.env.ALLOWED_DEV_ORIGINS ?? "").split(",")) {
    const host = extra
      .trim()
      .replace(/^https?:\/\//, "")
      .split("/")[0]
      ?.split(":")[0];
    if (host) origins.add(host);
  }
  for (const addrs of Object.values(os.networkInterfaces())) {
    for (const addr of addrs ?? []) {
      const family = String(addr.family);
      if (family !== "IPv4" && family !== "4") continue;
      if (addr.internal) continue;
      origins.add(addr.address);
    }
  }
  return [...origins];
}

const nextConfig: NextConfig = {
  allowedDevOrigins: lanDevOrigins(),
  // Tree-shake lucide icons — critical when many modules import from the package
  experimental: {
    optimizePackageImports: ["lucide-react"],
  },
  async redirects() {
    return [
      { source: "/calendar", destination: "/", permanent: false },
      { source: "/classes", destination: "/biomatic", permanent: false },
      { source: "/attendance", destination: "/tivazo", permanent: false },
      { source: "/assessments", destination: "/", permanent: false },
      { source: "/directory", destination: "/biomatic", permanent: false },
      { source: "/finance", destination: "/", permanent: false },
      { source: "/settings/access", destination: "/users", permanent: false },
    ];
  },
};

export default nextConfig;
