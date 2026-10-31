import { NextResponse, type NextFetchEvent, type NextRequest } from "next/server"
import { createServerClient } from "@supabase/ssr"
import { createClient } from "@supabase/supabase-js"
import { SEEN_COOKIE, authMode, decide, identityFromAuthUser, identityHeaders, isIdle, type Identity } from "@/lib/auth/decide"

// Every /api request: find who is calling (login cookie), decide with the rule list, and pass the identity on to the
// route as x-mm-* headers (copies sent by the browser are always removed). AUTH_MODE=off changes nothing.
const SEEN_REFRESH_MS = 5 * 60 * 1000

function audit(event: NextFetchEvent, row: Record<string, unknown>) {
  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) return
  const db = createClient(url, key, { auth: { persistSession: false } })
  event.waitUntil(
    Promise.resolve(db.from("auth_audit").insert(row)).then(
      () => undefined,
      () => undefined,
    ),
  )
}

export async function middleware(request: NextRequest, event: NextFetchEvent) {
  const path = request.nextUrl.pathname
  if (!path.startsWith("/api/") && path !== "/api") return

  const mode = authMode()
  if (mode === "off") return NextResponse.next({ request: { headers: identityHeaders(request.headers, null) } })

  // Session cookies refreshed by Supabase are copied onto whatever response we send.
  const refreshed: { name: string; value: string; options?: any }[] = []
  const supabase = createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: (list) => {
        refreshed.push(...list)
      },
    },
  })
  let identity: Identity | null = null
  try {
    const { data } = await supabase.auth.getUser()
    identity = identityFromAuthUser(data.user)
  } catch {
    identity = null
  }

  const now = Date.now()
  const seen = request.cookies.get(SEEN_COOKIE)?.value
  const decision = decide({ mode, path, method: request.method, identity, idle: !!identity && isIdle(seen, now) })

  const finish = (response: NextResponse) => {
    for (const c of refreshed) response.cookies.set(c.name, c.value, c.options)
    if (identity && decision.kind !== "refuse" && (!Number(seen) || now - Number(seen) > SEEN_REFRESH_MS)) {
      response.cookies.set(SEEN_COOKIE, String(now), { httpOnly: true, sameSite: "lax", secure: true, path: "/" })
    }
    return response
  }

  if (decision.kind === "refuse" || decision.kind === "would-refuse") {
    audit(event, {
      mode,
      decision: decision.kind,
      path,
      method: request.method,
      user_id: identity?.userId ?? null,
      roles: identity?.roles.join(",") ?? null,
      reason: decision.kind === "refuse" ? decision.body.error : decision.reason,
    })
  }
  if (decision.kind === "refuse") return finish(NextResponse.json(decision.body, { status: decision.status }))
  return finish(NextResponse.next({ request: { headers: identityHeaders(request.headers, identity) } }))
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)"],
}
