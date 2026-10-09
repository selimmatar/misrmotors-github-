// Lets the tests call the REAL Next.js route handlers (app/api/**/route.ts) in plain Node, with the Supabase
// admin client replaced by the in-memory FakeDb. Only the edges are replaced:
//   "@/..." imports      -> the compiled output tree (same files the app uses)
//   lib/supabase/admin   -> returns the current FakeDb
//   next/server          -> a minimal NextResponse (Response.json)
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
// Additive stubs used by the hardening tests: next/cache (revalidatePath), @vercel/blob (put) and lib/supabase/server
// (the work-order print route takes its admin client from there).
export const blobCalls: { name: string; contentType?: string; size: number }[] = []
const nextCacheStub = { revalidatePath: () => {}, revalidateTag: () => {} }
const blobStub = {
  put: async (name: string, body: ArrayBuffer, opts: { contentType?: string } = {}) => {
    blobCalls.push({ name, contentType: opts.contentType, size: body.byteLength })
    return { url: `https://blob.test/${name}` }
  },
  del: async () => {},
}
const SERVER_FILE = path.join(OUT_ROOT, "lib", "supabase", "server.js")
const serverStub = {
  createAdminClient: adminStub.createAdminClient,
  createClient: async () => adminStub.createAdminClient(),
  createServerClient: async () => adminStub.createAdminClient(),
}

const M = Module as any
const originalLoad = M._load
M._load = function (request: string, parent: any, isMain: boolean) {
  if (request === "next/server") return nextServerStub
  if (request === "next/cache") return nextCacheStub
  if (request === "@vercel/blob") return blobStub
  const mapped = request.startsWith("@/") ? path.join(OUT_ROOT, request.slice(2)) : request
  if (mapped.startsWith("/") || mapped.startsWith(".")) {
    let resolved: string | null = null
    try {
      resolved = M._resolveFilename(mapped, parent)
    } catch {
      resolved = null
    }
    if (resolved === ADMIN_FILE) return adminStub
    if (resolved === SERVER_FILE) return serverStub
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
