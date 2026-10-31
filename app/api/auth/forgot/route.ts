import { NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { STAFF_DOMAIN } from "@/lib/auth/decide"

export const dynamic = "force-dynamic"

// POST { email } — always answers ok, so nobody can find out which addresses have accounts.
// Username accounts have no real email: their password is reset by the Admin.
export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}))
  const email = String(body?.email || "").trim().toLowerCase()
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) && !email.endsWith(`@${STAFF_DOMAIN}`)) {
    const origin = new URL(request.url).origin
    const supabase: any = await createClient()
    await supabase.auth
      .resetPasswordForEmail(email, { redirectTo: `${origin}/auth/callback?next=/auth/reset` })
      .catch(() => undefined)
  }
  return NextResponse.json({ ok: true })
}
