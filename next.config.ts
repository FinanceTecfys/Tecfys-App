import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    // Informa PDFs are uploaded through a Server Action (default limit is 1 MB).
    serverActions: { bodySizeLimit: "20mb" },
  },
  // pdf.js (unpdf), exceljs and pdfkit ship their own assets: keep them external.
  serverExternalPackages: ["unpdf", "exceljs", "pdfkit"],
};

export default nextConfig;
