// The "last seen" cookie behind the 12-hour idle logout. Set with a plain header so it works on any Response.
import { SEEN_COOKIE } from "./decide"

export function setSeen(response: Response, now = Date.now()): Response {
  response.headers.append("Set-Cookie", `${SEEN_COOKIE}=${now}; Path=/; HttpOnly; Secure; SameSite=Lax`)
  return response
}

export function clearSeen(response: Response): Response {
  response.headers.append("Set-Cookie", `${SEEN_COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`)
  return response
}

/** Only same-site paths (start with one "/") are allowed after the email link; anything else goes home. */
export function safeNext(next: string | null | undefined): string {
  const value = String(next || "")
  return value.startsWith("/") && !value.startsWith("//") && !value.startsWith("/\\") ? value : "/"
}
