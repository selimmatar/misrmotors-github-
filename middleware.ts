import type { NextRequest } from "next/server"

export function middleware(request: NextRequest) {
  // Just pass through - auth checks will be handled in page components
  return
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)"],
}
