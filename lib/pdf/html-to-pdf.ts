// Turns one of the app's print pages into a PDF, for "Send to customer" (owner request 2026-11-27). A headless Chromium
// opens the page by its signed link (lib/doc-links.ts) so it prints exactly what staff print, with the logo and fonts,
// and saves it as A4 PDF with the page's own print settings (the company header repeats on every page).
// On Vercel: @sparticuz/chromium. Elsewhere (local runs): PDF_CHROME_PATH, else the usual Chromium locations.
import { existsSync } from "node:fs"

export type UrlToPdf = (url: string) => Promise<Buffer>

const LOCAL_CHROME = ["/opt/pw-browsers/chromium", "/usr/bin/chromium", "/usr/bin/chromium-browser", "/usr/bin/google-chrome"]

async function launch() {
  const puppeteer = (await import("puppeteer-core")).default
  if (process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME) {
    const chromium = (await import("@sparticuz/chromium")).default
    return puppeteer.launch({ args: chromium.args, executablePath: await chromium.executablePath(), headless: true })
  }
  const path = process.env.PDF_CHROME_PATH || LOCAL_CHROME.find((p) => existsSync(p))
  if (!path) throw new Error("No Chromium found to make the PDF (set PDF_CHROME_PATH)")
  return puppeteer.launch({ executablePath: path, headless: true, args: ["--no-sandbox"] })
}

/** The page at `url` as an A4 PDF. Throws when the page does not open or is not a document. */
export const urlToPdf: UrlToPdf = async (url) => {
  const browser = await launch()
  try {
    const page = await browser.newPage()
    const res = await page.goto(url, { waitUntil: "networkidle0", timeout: 45_000 })
    if (!res || !res.ok()) throw new Error(`The document page did not open (${res ? res.status() : "no answer"})`)
    await page.evaluate(() => (document as any).fonts?.ready)
    const pdf = await page.pdf({ format: "A4", printBackground: true, preferCSSPageSize: true })
    return Buffer.from(pdf)
  } finally {
    await browser.close().catch(() => undefined)
  }
}
