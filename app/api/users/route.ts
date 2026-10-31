import { NextResponse } from "next/server"
import { createAdminClient } from "@/lib/supabase/admin"
import { loginAddress } from "@/lib/auth/decide"
import { actorUserId } from "@/lib/auth/actor"
import { isRole } from "@/lib/auth/roles"
import { MIN_PASSWORD, cleanEmployeeId, cleanRoles, loginMetadata, validateNewUser } from "@/lib/auth/users-admin"

export const dynamic = "force-dynamic"

// Admin only (lib/auth/permissions.ts). Accounts are never deleted — turned off instead — so "who did this" history
// keeps pointing at a real person.
const BAN_FOREVER = "876000h"

function listShape(row: any) {
  const isUsername = row.login_method === "username"
  return {
    userId: row.user_id,
    fullName: row.full_name,
    loginMethod: row.login_method || "email",
    email: isUsername ? null : row.email,
    username: isUsername ? row.username : null,
    roles: (Array.isArray(row.roles) ? row.roles : []).filter(isRole),
    employeeId: row.employee_id ?? null,
    active: row.is_active !== false,
    mustChangePassword: !!row.must_change_password,
    lastLoginAt: row.last_login_at ?? null,
  }
}
const fail = (status: number, error: string) => NextResponse.json({ error }, { status })
const isDuplicate = (error: any) =>
  error?.code === "23505" || /already (been )?registered|already exists/i.test(String(error?.message || ""))

export async function GET() {
  const db: any = createAdminClient()
  const { data, error } = await db.from("users").select("*").order("full_name", { ascending: true })
  if (error) return fail(500, error.message || "Could not load accounts")
  return NextResponse.json((data || []).map(listShape))
}

export async function POST(request: Request) {
  const checked = validateNewUser(await request.json().catch(() => null))
  if (!checked.ok) return fail(400, checked.error)
  const u = checked.value
  const address = loginAddress(u.loginMethod === "email" ? u.email! : u.username!)
  const db: any = createAdminClient()

  const { data: taken } = await db.from("users").select("user_id").eq("email", address).maybeSingle()
  if (taken) return fail(409, "This email or username is already used")

  const created = await db.auth.admin.createUser({
    email: address,
    password: u.tempPassword,
    email_confirm: true,
    app_metadata: { roles: u.roles, name: u.fullName, active: true },
  })
  const authUser = created?.data?.user
  if (created?.error || !authUser) {
    if (isDuplicate(created?.error)) return fail(409, "This email or username is already used")
    return fail(500, created?.error?.message || "Could not create the login")
  }

  const { data: row, error: insertError } = await db
    .from("users")
    .insert({
      full_name: u.fullName,
      email: address,
      username: u.loginMethod === "username" ? u.username : null,
      login_method: u.loginMethod,
      role: null,
      roles: u.roles,
      employee_id: u.employeeId ?? null,
      is_active: true,
      must_change_password: true,
      auth_user_id: authUser.id,
    })
    .select("*")
    .single()
  if (insertError || !row) {
    await db.auth.admin.deleteUser(authUser.id).catch(() => undefined)
    if (isDuplicate(insertError)) return fail(409, "This email or username is already used")
    return fail(500, insertError?.message || "Could not save the account")
  }

  const meta = await db.auth.admin.updateUserById(authUser.id, {
    app_metadata: loginMetadata(row.user_id, u.roles, u.fullName, true),
  })
  if (meta?.error) return fail(500, "Account saved but its roles could not be attached; edit and save it again")
  return NextResponse.json({ user: listShape(row) })
}

export async function PUT(request: Request) {
  const body = await request.json().catch(() => ({}))
  const userId = Number(body?.userId)
  const action = String(body?.action || "")
  if (!Number.isInteger(userId) || userId < 1) return fail(400, "Missing account")
  if (!["update", "reset-password", "deactivate", "reactivate"].includes(action)) return fail(400, "Unknown action")

  const db: any = createAdminClient()
  const { data: row } = await db.from("users").select("*").eq("user_id", userId).maybeSingle()
  if (!row) return fail(404, "Account not found")
  const actor = actorUserId(request)
  const isSelf = actor !== null && actor === userId
  const currentRoles = (Array.isArray(row.roles) ? row.roles : []).filter(isRole)
  const syncLogin = async (attrs: Record<string, unknown>) => {
    if (!row.auth_user_id) return null
    const res = await db.auth.admin.updateUserById(row.auth_user_id, attrs)
    return res?.error || null
  }

  if (action === "update") {
    const changes: Record<string, unknown> = {}
    let fullName = row.full_name
    let roles = currentRoles
    if (body.fullName !== undefined) {
      fullName = String(body.fullName).trim()
      if (!fullName) return fail(400, "Name is required")
      changes.full_name = fullName
    }
    if (body.roles !== undefined) {
      const cleaned = cleanRoles(body.roles)
      if (!cleaned) return fail(400, "Choose at least one valid role")
      if (isSelf && currentRoles.includes("admin") && !cleaned.includes("admin")) {
        return fail(400, "You cannot remove your own Admin role")
      }
      roles = cleaned
      changes.roles = cleaned
    }
    if (body.employeeId !== undefined) {
      const employeeId = cleanEmployeeId(body.employeeId)
      if (employeeId === undefined) return fail(400, "Invalid HR employee")
      changes.employee_id = employeeId
    }
    const { error } = await db.from("users").update(changes).eq("user_id", userId)
    if (error) return fail(500, error.message || "Could not save")
    const loginError = await syncLogin({ app_metadata: loginMetadata(userId, roles, fullName, row.is_active !== false) })
    if (loginError) return fail(500, "Saved, but the login could not be updated; save again")
    return NextResponse.json({ user: listShape({ ...row, ...changes }) })
  }

  if (action === "reset-password") {
    const tempPassword = String(body.tempPassword || "")
    if (tempPassword.length < MIN_PASSWORD) return fail(400, `Password must be at least ${MIN_PASSWORD} characters`)
    const loginError = await syncLogin({ password: tempPassword })
    if (loginError) return fail(500, loginError.message || "Could not set the password")
    await db.from("users").update({ must_change_password: true }).eq("user_id", userId)
    return NextResponse.json({ ok: true })
  }

  const turnOn = action === "reactivate"
  if (!turnOn && isSelf) return fail(400, "You cannot turn off your own account")
  const loginError = await syncLogin({
    ban_duration: turnOn ? "none" : BAN_FOREVER,
    app_metadata: loginMetadata(userId, currentRoles, row.full_name, turnOn),
  })
  if (loginError) return fail(500, loginError.message || "Could not update the login")
  const { error } = await db.from("users").update({ is_active: turnOn }).eq("user_id", userId)
  if (error) return fail(500, error.message || "Could not save")
  return NextResponse.json({ user: listShape({ ...row, is_active: turnOn }) })
}
