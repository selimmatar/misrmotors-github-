import type React from "react"
import type { Metadata, Viewport } from "next"
import { Manrope, Almarai } from "next/font/google"
import "./globals.css"
import { I18nProvider } from "@/lib/i18n-context"
import { Toaster } from "@/components/ui/toaster"

const manrope = Manrope({ subsets: ["latin"], variable: "--font-manrope", display: "swap" })
const almarai = Almarai({
  subsets: ["arabic"],
  weight: ["400", "700", "800"],
  variable: "--font-almarai",
  display: "swap",
})

export const metadata: Metadata = {
  metadataBase: new URL("https://misrmotors.app"),
  title: "Misr Motors | مصر موتورز",
  description:
    "Misr Motors Management System - vehicle sales, spare parts, service orders, invoicing and reporting. نظام إدارة مصر موتورز.",
  alternates: { canonical: "/" },
  openGraph: {
    title: "Misr Motors | مصر موتورز",
    description: "Automotive dealership and workshop management system.",
    url: "https://misrmotors.app",
    siteName: "Misr Motors",
    type: "website",
  },
  robots: { index: true, follow: true },
  generator: "v0.app",
  icons: {
    icon: "/icon.svg",
  },
}

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html lang="en">
      <body className={`${manrope.variable} ${almarai.variable} font-sans antialiased`}>
        <I18nProvider>
          {children}
          <Toaster />
        </I18nProvider>
      </body>
    </html>
  )
}
