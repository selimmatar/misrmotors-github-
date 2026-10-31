import { NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { createAdminClient } from "@/lib/supabase/admin"
import { loginAddress } from "@/lib/auth/decide"
import { isRole } from "@/lib/auth/roles"
import { setSeen } from "@/lib/auth/session-cookie"

export const dynamic = "force-dynamic"

// POST { identifier: email or username, password }
export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}))
  const identifier = String(body?.identifier || "").trim()
  const password = String(body?.password || "")
  const badLogin = () => NextResponse.json({ error: "Wrong login or password", code: "BAD_LOGIN" }, { status: 401 })
  if (!identifier || !password) return badLogin()

  const supabase: any = await createClient()
  const { data, error } = await supabase.auth.signInWithPassword({ email: loginAddress(identifier), password })
  if (error || !data?.user) return badLogin()

  const db: any = createAdminClient()
  const { data: row } = await db.from("users").select("*").eq("auth_user_id", data.user.id).maybeSingle()
  if (!row || row.is_active === false) {
    await supabase.auth.signOut()
    return NextResponse.json({ error: "This account is turned off", code: "ACCOUNT_OFF" }, { status: 403 })
  }
  await db.from("users").update({ last_login_at: new Date().toISOString() }).eq("user_id", row.user_id)

  return setSeen(
    NextResponse.json({
      user: {
        userId: row.user_id,
        name: row.full_name,
        roles: (Array.isArray(row.roles) ? row.roles : []).filter(isRole),
        mustChangePassword: !!row.must_change_password,
      },
    }),
  )
}
