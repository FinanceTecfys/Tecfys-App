/**
 * Largest Informa PDF accepted, checked in the browser (before the upload) and
 * again by the server action. A Vercel Function takes at most 4.5 MB per request
 * body, multipart envelope included; 4 MB leaves the margin. Real Informa
 * Comercial reports weigh 0.2-1.1 MB.
 */
export const MAX_PDF_MB = 4;
export const MAX_PDF_BYTES = MAX_PDF_MB * 1024 * 1024;
