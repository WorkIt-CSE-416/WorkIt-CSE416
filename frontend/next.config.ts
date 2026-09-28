import type { NextConfig } from "next";

const nextConfig: NextConfig = {
    // Resumes are up to 5 MB
    experimental: {serverActions: {bodySizeLimit: "6mb" } },
};

export default nextConfig;


