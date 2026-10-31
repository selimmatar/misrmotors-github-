import { createClient } from "@/lib/supabase/server"
import { safeNext } from "@/lib/auth/session-cookie"

export const dynamic = "force-dynamic"

// The emailed "reset password" link lands here: exchange the code for a session, then go to the reset page.
export async function GET(request: Request) {
  const url = new URL(request.url)
  const code = url.searchParams.get("code")
  const next = safeNext(url.searchParams.get("next"))
  if (code) {
    const supabase: any = await createClient()
    await supabase.auth.exchangeCodeForSession(code).catch(() => undefined)
  }
  return new Response(null, { status: 307, headers: { Location: new URL(next, url.origin).toString() } })
}
