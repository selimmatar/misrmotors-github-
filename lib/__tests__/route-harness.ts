// Lets the tests call the REAL Next.js route handlers (app/api/**/route.ts) in plain Node, with the Supabase
// admin client replaced by the in-memory FakeDb. Only the edges are replaced:
//   "@/..." imports      -> the compiled output tree (same files the app uses)
//   lib/supabase/admin   -> returns the current FakeDb
//   next/server          -> a minimal NextResponse (Response.json)
//   lib/webhook-service  -> no-op trigger
// Import this module BEFORE importing any route.
import path from "node:path"
import Module from "node:module"
import type { FakeDb } from "./fake-db"

let current: FakeDb | null = null
export function useDb(db: FakeDb) {
  current = db
}

const OUT_ROOT = path.resolve(__dirname, "..", "..") // <out>/lib/__tests__ -> <out>
const ADMIN_FILE = path.join(OUT_ROOT, "lib", "supabase", "admin.js")
const WEBHOOK_FILE = path.join(OUT_ROOT, "lib", "webhook-service.js")

// `new NextResponse(html, init)` is used by the HTML print routes; `NextResponse.json` by the API routes.
class StubNextResponse extends Response {
  static json(body: unknown, init?: ResponseInit) {
    return Response.json(body, init)
  }
}
const nextServerStub = {
  NextResponse: StubNextResponse,
  NextRequest: Request,
}
const adminStub = {
  createAdminClient: () => {
    if (!current) throw new Error("route-harness: useDb() was not called")
    return current
  },
  getAdminClient: () => {
    if (!current) throw new Error("route-harness: useDb() was not called")
    return current
  },
}
/** Webhook events the routes fired (cleared by the tests that look at it). */
export const webhookCalls: { event: string; payload: any }[] = []
export const webhookControl = { fail: false }
const webhookStub = {
  WebhookService: {
    getInstance: () => ({
      trigger: async (event: string, payload: any) => {
        if (webhookControl.fail) throw new Error("webhook down")
        webhookCalls.push({ event, payload })
      },
    }),
  },
}

const M = Module as any
const originalLoad = M._load
M._load = function (request: string, parent: any, isMain: boolean) {
  if (request === "next/server") return nextServerStub
  const mapped = request.startsWith("@/") ? path.join(OUT_ROOT, request.slice(2)) : request
  if (mapped.startsWith("/") || mapped.startsWith(".")) {
    let resolved: string | null = null
    try {
      resolved = M._resolveFilename(mapped, parent)
    } catch {
      resolved = null
    }
    if (resolved === ADMIN_FILE) return adminStub
    if (resolved === WEBHOOK_FILE) return webhookStub
    return originalLoad.call(this, resolved ?? mapped, parent, isMain)
  }
  return originalLoad.call(this, request, parent, isMain)
}

/** Build a JSON request for a route handler. */
export function jsonRequest(method: string, body?: unknown, url = "http://test.local/api") {
  return new Request(url, { method, headers: { "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) })
}
/** Call a handler and return { status, body }. */
export async function call(handler: (req: any) => Promise<Response>, method: string, body?: unknown, url?: string) {
  const res = await handler(jsonRequest(method, body, url))
  let parsed: any = null
  try {
    parsed = await res.json()
  } catch {
    parsed = null
  }
  return { status: res.status, body: parsed }
}
