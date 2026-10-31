import { NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { createAdminClient } from "@/lib/supabase/admin"

export const dynamic = "force-dynamic"

// POST { password } — the logged-in person sets a new password (first login, or after the email link).
export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}))
  const password = String(body?.password || "")
  const supabase: any = await createClient()
  const { data } = await supabase.auth.getUser()
  if (!data?.user) return NextResponse.json({ error: "Please log in", code: "AUTH_REQUIRED" }, { status: 401 })
  if (password.length < 8) {
    return NextResponse.json({ error: "Password must be at least 8 characters", code: "WEAK_PASSWORD" }, { status: 400 })
  }
  const { error } = await supabase.auth.updateUser({ password })
  if (error) return NextResponse.json({ error: error.message || "Could not change the password" }, { status: 400 })
  const db: any = createAdminClient()
  await db.from("users").update({ must_change_password: false }).eq("auth_user_id", data.user.id)
  return NextResponse.json({ ok: true })
}
