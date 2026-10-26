import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

// i18n without locale routing: the language comes from the user's profile (src/i18n/request.ts).
const withNextIntl = createNextIntlPlugin("./src/i18n/request.ts");

const nextConfig: NextConfig = {
  experimental: {
    // Informa PDFs are uploaded through a Server Action (default limit is 1 MB).
    serverActions: { bodySizeLimit: "20mb" },
  },
  // pdf.js (unpdf), exceljs and pdfkit ship their own assets: keep them external.
  serverExternalPackages: ["unpdf", "exceljs", "pdfkit"],
};

export default withNextIntl(nextConfig);
