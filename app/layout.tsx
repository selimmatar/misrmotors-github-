import type React from "react"
import type { Metadata, Viewport } from "next"
import { Manrope, Almarai } from "next/font/google"
import "./globals.css"
import { I18nProvider } from "@/lib/i18n-context"

const manrope = Manrope({ subsets: ["latin"], variable: "--font-manrope", display: "swap" })
const almarai = Almarai({
  subsets: ["arabic"],
  weight: ["400", "700", "800"],
  variable: "--font-almarai",
  display: "swap",
})

export const metadata: Metadata = {
  title: "Misr Motors",
  description: "Misr Motors Management System",
  generator: "v0.app",
  icons: {
    icon: "/icon.svg",
  },
}

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html lang="en">
      <body className={`${manrope.variable} ${almarai.variable} font-sans antialiased`}>
        <I18nProvider>{children}</I18nProvider>
      </body>
    </html>
  )
}
