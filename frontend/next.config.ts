import type { NextConfig } from "next";

const nextConfig: NextConfig = {
    // Resumes and profile photos are both capped at 5 MB (resumes.py,
    // services/avatar.py, src/lib/avatar-rules.ts); this must stay above that
    // plus multipart overhead, or Next rejects the upload before the action runs.
    experimental: {serverActions: {bodySizeLimit: "6mb" } },
};

export default nextConfig;


