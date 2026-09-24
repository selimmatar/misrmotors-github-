const CLIENT_ID_STORAGE_KEY = "misrmotors-client-id"

/**
 * This app's login screen has no real accounts — picking a role generates a brand new,
 * timestamp-based `User.id` every time (see components/auth/login-page.tsx), so it can't be
 * used to recognize "the same person" across a logout/login cycle. This helper instead persists
 * a random id in localStorage, stable for as long as the browser keeps it, so per-browser state
 * (like an in-progress quotation draft) can survive a logout without colliding with other
 * browsers/devices using the same role.
 */
export function getOrCreateClientId(): string {
  if (typeof window === "undefined") return ""

  try {
    const existing = window.localStorage.getItem(CLIENT_ID_STORAGE_KEY)
    if (existing) return existing

    const generated =
      typeof crypto !== "undefined" && "randomUUID" in crypto
        ? crypto.randomUUID()
        : `client-${Date.now()}-${Math.random().toString(36).slice(2)}`

    window.localStorage.setItem(CLIENT_ID_STORAGE_KEY, generated)
    return generated
  } catch {
    return ""
  }
}
