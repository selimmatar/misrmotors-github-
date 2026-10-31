// Rules for accounts the Admin creates. Pure functions; app/api/users/route.ts does the saving.
import type { UserRole } from "@/lib/types"
import { isRole } from "./roles"
import { STAFF_DOMAIN } from "./decide"

export type LoginMethod = "email" | "username"
export interface NewUser {
  fullName: string
  loginMethod: LoginMethod
  email?: string
  username?: string
  roles: UserRole[]
  employeeId?: number | null
  tempPassword: string
}
export type Checked<T> = { ok: true; value: T } | { ok: false; error: string }

export const MIN_PASSWORD = 8
export const USERNAME_PATTERN = /^[a-z0-9][a-z0-9._-]{2,31}$/
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

/** Known roles only, no repeats, in the order given. Returns null when none are valid or any is unknown. */
export function cleanRoles(value: unknown): UserRole[] | null {
  if (!Array.isArray(value) || value.length === 0 || !value.every(isRole)) return null
  return [...new Set(value as UserRole[])]
}

/** null / "" → null; a positive whole number → that number; anything else → undefined (invalid). */
export function cleanEmployeeId(value: unknown): number | null | undefined {
  if (value === null || value === undefined || value === "") return null
  const n = Number(value)
  return Number.isInteger(n) && n > 0 ? n : undefined
}

export function validateNewUser(b: unknown): Checked<NewUser> {
  if (!b || typeof b !== "object") return { ok: false, error: "Missing details" }
  const body = b as Record<string, unknown>
  const fullName = String(body.fullName ?? "").trim()
  if (!fullName) return { ok: false, error: "Name is required" }
  const method = String(body.loginMethod ?? "")
  if (method === "phone") return { ok: false, error: "Phone login is coming soon" }
  if (method !== "email" && method !== "username") return { ok: false, error: "Choose email or username login" }
  const roles = cleanRoles(body.roles)
  if (!roles) return { ok: false, error: "Choose at least one valid role" }
  const employeeId = cleanEmployeeId(body.employeeId)
  if (employeeId === undefined) return { ok: false, error: "Invalid HR employee" }
  const tempPassword = String(body.tempPassword ?? "")
  if (tempPassword.length < MIN_PASSWORD) return { ok: false, error: `Password must be at least ${MIN_PASSWORD} characters` }

  if (method === "email") {
    const email = String(body.email ?? "").trim().toLowerCase()
    if (!EMAIL_PATTERN.test(email) || email.endsWith(`@${STAFF_DOMAIN}`)) return { ok: false, error: "Enter a valid email address" }
    return { ok: true, value: { fullName, loginMethod: "email", email, roles, employeeId, tempPassword } }
  }
  const username = String(body.username ?? "").trim().toLowerCase()
  if (!USERNAME_PATTERN.test(username)) {
    return { ok: false, error: "Username: 3–32 letters, numbers, dot, dash or underscore" }
  }
  return { ok: true, value: { fullName, loginMethod: "username", username, roles, employeeId, tempPassword } }
}

/** The login's app_metadata: what middleware.ts reads to know who is calling. Only the server can write it. */
export function loginMetadata(userId: number, roles: UserRole[], name: string, active: boolean) {
  return { app_user_id: userId, roles, name, active }
}
