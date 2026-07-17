import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  allowedDevOrigins: ["127.0.0.1", "localhost", "192.168.4.20"],
  devIndicators: false,
};

export default nextConfig;
