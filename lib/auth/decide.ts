// The server's decision for every /api request: who is calling (from the login), and may their roles do this?
// Pure functions only; middleware.ts does the cookie and network work around them.
import type { UserRole } from "@/lib/types"
import { isRole } from "./roles"
import { PUBLIC_PATHS, allows, ruleFor } from "./permissions"

export type AuthMode = "off" | "test" | "on"

/** AUTH_MODE on Vercel: "off" (default, nothing enforced), "test" (only records refusals), "on" (enforced). */
// Production: "on" since 2026-11-14 (owner request). Switching back to "test" in Vercel needs a new build to apply.
export function authMode(env: Record<string, string | undefined> = process.env): AuthMode {
  const value = String(env.AUTH_MODE || "").trim().toLowerCase()
  return value === "on" || value === "test" ? value : "off"
}

export interface Identity {
  userId: number
  name: string
  roles: UserRole[]
  active: boolean
}

/** Reads the person from the login's app_metadata (only the server can write it), never from user_metadata. */
export function identityFromAuthUser(
  user: { app_metadata?: any; banned_until?: string | null } | null | undefined,
): Identity | null {
  const meta = user?.app_metadata
  const userId = Number(meta?.app_user_id)
  if (!Number.isInteger(userId) || userId < 1) return null
  const roles = Array.isArray(meta.roles) ? (meta.roles.filter(isRole) as UserRole[]) : []
  const banned = !!user?.banned_until && new Date(user.banned_until).getTime() > Date.now()
  return { userId, name: String(meta.name || ""), roles, active: meta.active !== false && !banned }
}

export const STAFF_DOMAIN = "staff.misrmotors.app"

/** "Email or username" -> the address Supabase logs in with. Usernames map to a hidden staff address. */
export function loginAddress(identifier: string): string {
  const value = String(identifier || "").trim().toLowerCase()
  return value.includes("@") ? value : `${value}@${STAFF_DOMAIN}`
}

export const IDLE_MS = 12 * 60 * 60 * 1000
export const SEEN_COOKIE = "mm_seen"

/** True when the last request (mm_seen, ms since epoch) was more than 12 hours ago. */
export function isIdle(seen: string | undefined, now: number): boolean {
  const last = Number(seen)
  if (!seen || !Number.isFinite(last)) return false
  return now - last > IDLE_MS
}

type Code = "AUTH_REQUIRED" | "FORBIDDEN"
export type Decision =
  | { kind: "allow" }
  | { kind: "would-refuse"; status: 401 | 403; reason: string }
  | { kind: "refuse"; status: 401 | 403; body: { error: string; code: Code } }

export function decide(input: { mode: AuthMode; path: string; method: string; identity: Identity | null; idle: boolean }): Decision {
  const { mode, path, method, identity, idle } = input
  if (mode === "off" || !(path === "/api" || path.startsWith("/api/"))) return { kind: "allow" }
  if (PUBLIC_PATHS.includes(path)) return { kind: "allow" }

  let status: 401 | 403 | null = null
  let error = ""
  if (!identity || !identity.active || idle) {
    status = 401
    error = !identity ? "Please log in" : !identity.active ? "This account is turned off" : "Logged out after 12 hours without use"
  } else {
    const rule = ruleFor(path)
    if (!rule) {
      status = 403
      error = "This action is not open to any role"
    } else if (!allows(rule, method, identity.roles)) {
      status = 403
      const reading = ["GET", "HEAD"].includes(method.toUpperCase())
      error = `Your role cannot ${reading ? "see" : "change"} this (${rule.prefix})`
    }
  }
  if (status === null) return { kind: "allow" }
  if (mode === "test") return { kind: "would-refuse", status, reason: error }
  return { kind: "refuse", status, body: { error, code: status === 401 ? "AUTH_REQUIRED" : "FORBIDDEN" } }
}

const IDENTITY_HEADERS = ["x-mm-user-id", "x-mm-roles", "x-mm-name"]

/** A copy of the request headers with any incoming x-mm-* removed, then the real identity added (when known). */
export function identityHeaders(incoming: Headers, identity: Identity | null): Headers {
  const headers = new Headers(incoming)
  for (const name of Array.from(headers.keys())) if (name.toLowerCase().startsWith("x-mm-")) headers.delete(name)
  for (const name of IDENTITY_HEADERS) headers.delete(name)
  if (identity) {
    headers.set("x-mm-user-id", String(identity.userId))
    headers.set("x-mm-roles", identity.roles.join(","))
    headers.set("x-mm-name", encodeURIComponent(identity.name))
  }
  return headers
}
