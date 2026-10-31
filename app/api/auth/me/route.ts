import { NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { createAdminClient } from "@/lib/supabase/admin"
import { authMode } from "@/lib/auth/decide"
import { isRole } from "@/lib/auth/roles"

export const dynamic = "force-dynamic"

// { mode, user | null } — the login screen needs the mode even when nobody is logged in.
export async function GET() {
  const mode = authMode()
  const supabase: any = await createClient()
  const { data } = await supabase.auth.getUser().catch(() => ({ data: null }))
  const authUser = data?.user
  if (!authUser) return NextResponse.json({ mode, user: null })
  const db: any = createAdminClient()
  const { data: row } = await db.from("users").select("*").eq("auth_user_id", authUser.id).maybeSingle()
  if (!row || row.is_active === false) return NextResponse.json({ mode, user: null })
  return NextResponse.json({
    mode,
    user: {
      userId: row.user_id,
      name: row.full_name,
      email: row.login_method === "email" ? row.email : null,
      username: row.username || null,
      roles: (Array.isArray(row.roles) ? row.roles : []).filter(isRole),
      mustChangePassword: !!row.must_change_password,
    },
  })
}
