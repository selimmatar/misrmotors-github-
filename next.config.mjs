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
}

export default nextConfig
