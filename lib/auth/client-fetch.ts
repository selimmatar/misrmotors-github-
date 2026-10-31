// In the browser: watches every API answer. "Please log in" (401 AUTH_REQUIRED) returns to the login screen;
// "not allowed" (403 FORBIDDEN) shows a message and keeps the person where they are.
export type AuthAction = "logout" | "forbidden" | null

export function responseAction(status: number, body: unknown): AuthAction {
  const code = body && typeof body === "object" ? (body as { code?: unknown }).code : undefined
  if (status === 401 && code === "AUTH_REQUIRED") return "logout"
  if (status === 403 && code === "FORBIDDEN") return "forbidden"
  return null
}

const INSTALLED = Symbol.for("mm.authFetch")

/** Wraps window.fetch once. Returns a function that removes the wrapper. */
export function installAuthFetch(handlers: { onLogout: () => void; onForbidden: (message?: string) => void }): () => void {
  const w = window as any
  if (w[INSTALLED]) return () => {}
  const original: typeof fetch = window.fetch.bind(window)
  const wrapped: typeof fetch = async (input, init) => {
    const res = await original(input, init)
    if ((res.status === 401 || res.status === 403) && (res.headers.get("content-type") || "").includes("application/json")) {
      const body = await res.clone().json().catch(() => null)
      const action = responseAction(res.status, body)
      if (action === "logout") handlers.onLogout()
      else if (action === "forbidden") handlers.onForbidden(body?.error)
    }
    return res
  }
  window.fetch = wrapped
  w[INSTALLED] = true
  return () => {
    if (window.fetch === wrapped) window.fetch = original
    w[INSTALLED] = false
  }
}
