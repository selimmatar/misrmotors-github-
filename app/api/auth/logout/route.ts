import { NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { clearSeen } from "@/lib/auth/session-cookie"

export const dynamic = "force-dynamic"

export async function POST() {
  const supabase: any = await createClient()
  await supabase.auth.signOut().catch(() => undefined)
  return clearSeen(NextResponse.json({ ok: true }))
}
