"use client"

import type { ReactNode } from "react"
import dynamic from "next/dynamic"

// Dynamically import SWRConfig to avoid module resolution issues
const SWRConfig = dynamic(
  () => import("swr").then((mod) => mod.SWRConfig as any),
  { ssr: false }
) as any

// Global fetcher with error handling and rate limit retry
const fetcher = async (url: string) => {
  const response = await fetch(url)

  if (response.status === 429) {
    // Rate limited - throw error to trigger SWR retry
    throw new Error("Rate limited")
  }

  if (!response.ok) {
    throw new Error(`Failed to fetch: ${response.status}`)
  }

  const text = await response.text()
  if (!text || text.trim() === "") {
    return null
  }

  return JSON.parse(text)
}

export function SWRProvider({ children }: { children: ReactNode }) {
  return (
    <SWRConfig
      value={{
        fetcher,
        revalidateOnFocus: false, // Don't refetch when window regains focus
        revalidateOnReconnect: true, // Refetch when network reconnects
        dedupingInterval: 5000, // Dedupe requests within 5 seconds
        errorRetryCount: 3, // Retry failed requests 3 times
        errorRetryInterval: 2000, // Wait 2 seconds between retries
        refreshInterval: 0, // No automatic refresh (we control this)
        shouldRetryOnError: (error) => {
          // Don't retry on 401/403, do retry on rate limits
          if (error?.message?.includes("Rate limited")) return true
          return false
        },
      }}
    >
      {children}
    </SWRConfig>
  )
}
