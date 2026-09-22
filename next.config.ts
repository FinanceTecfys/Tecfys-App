import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    // Informa PDFs are uploaded through a Server Action (default limit is 1 MB).
    serverActions: { bodySizeLimit: "20mb" },
  },
  // pdf.js (via unpdf) must stay a runtime dependency of the server bundle.
  serverExternalPackages: ["unpdf"],
};

export default nextConfig;
