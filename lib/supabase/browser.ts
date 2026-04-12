import { createBrowserClient } from "@supabase/ssr"
import type { SupabaseClient } from "@supabase/supabase-js"

let browserClient: SupabaseClient | null = null

function initializeBrowserClient() {
  if (typeof window === "undefined") {
    throw new Error("Browser client can only be initialized in the browser")
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

  if (!url || !key) {
    throw new Error("Missing Supabase environment variables")
  }

  return createBrowserClient(url, key)
}

// Initialize the singleton immediately on module load (client-side only)
if (typeof window !== "undefined" && !browserClient) {
  browserClient = initializeBrowserClient()
}

// Export the singleton instance directly
export const supabase = browserClient!

// Export getter for programmatic access
export function getSupabaseBrowser() {
  if (!browserClient) {
    browserClient = initializeBrowserClient()
  }
  return browserClient
}
