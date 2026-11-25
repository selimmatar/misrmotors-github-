/** @type {import('next').NextConfig} */
const nextConfig = {
  typescript: {
    ignoreBuildErrors: true,
  },
  images: {
    unoptimized: true,
  },
  // the PDF maker for "Send to customer" (lib/pdf/html-to-pdf.ts): a headless Chromium, loaded as is at run time
  serverExternalPackages: ["@sparticuz/chromium", "puppeteer-core"],
  // its compressed Chromium (bin/*.br) is read from disk, not imported, so the file tracer misses it unless listed here
  outputFileTracingIncludes: {
    "/api/document-email": [
      "./node_modules/@sparticuz/chromium/bin/**",
      "./node_modules/.pnpm/@sparticuz+chromium@*/node_modules/@sparticuz/chromium/bin/**",
    ],
  },
}

export default nextConfig
