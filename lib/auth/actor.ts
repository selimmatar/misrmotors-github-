// "Who is doing this": the logged-in person (x-mm-user-id, set only by middleware.ts — copies sent by the browser are
// removed there). Until logins are switched on there is no header, so the old value from the request body is used.
function positiveInt(value: unknown): number | null {
  const n = Number(value)
  return Number.isInteger(n) && n > 0 ? n : null
}

export function actorUserId(request: Request, fallback?: unknown): number | null {
  return positiveInt(request.headers.get("x-mm-user-id")) ?? positiveInt(fallback)
}

export function actorName(request: Request): string | null {
  const raw = request.headers.get("x-mm-name")
  if (!raw) return null
  try {
    return decodeURIComponent(raw)
  } catch {
    return null
  }
}

/**
 * For routes that pass the acting user on as text: the login id (as text) when logged in, otherwise the old value
 * from the request exactly as it was (so nothing changes while logins are switched off).
 */
export function actorOr<T>(request: Request, fallback: T): string | T {
  const id = positiveInt(request.headers.get("x-mm-user-id"))
  return id !== null ? String(id) : fallback
}
