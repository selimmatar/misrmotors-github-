// The only module that talks to the ETA portal. Secrets come from env vars and never appear in errors or logs.
import { request as httpsRequest } from "node:https"
import { rootCertificates } from "node:tls"
import { plainError } from "./portal-errors"
import { PREPROD_ROOT_CA } from "./preprod-root-ca"

export type EtaEnv = "test" | "real"
export type FetchFn = typeof fetch

const HOSTS = {
  test: { idUrl: "https://id.preprod.eta.gov.eg", apiUrl: "https://api.preprod.invoicing.eta.gov.eg" },
  real: { idUrl: "https://id.eta.gov.eg", apiUrl: "https://api.invoicing.eta.gov.eg" },
} as const

export function portalConfig(env: EtaEnv): { idUrl: string; apiUrl: string; clientId?: string; clientSecret?: string } {
  const p = env === "test" ? "ETA_TEST_" : "ETA_"
  return {
    ...HOSTS[env],
    clientId: process.env[`${p}CLIENT_ID`] || undefined,
    clientSecret: process.env[`${p}CLIENT_SECRET`] || undefined,
  }
}

export function credentialsSet(env: EtaEnv): boolean {
  const c = portalConfig(env)
  return !!(c.clientId && c.clientSecret)
}

export class EtaError extends Error {
  status: number
  code: string
  details: unknown
  retryAfter?: number
  constructor(status: number, code: string, message: string, details?: unknown, retryAfter?: number) {
    super(message)
    this.name = "EtaError"
    this.status = status
    this.code = code
    this.details = details
    this.retryAfter = retryAfter
  }
}
export class EtaBusyError extends EtaError {
  constructor(retryAfter?: number) {
    super(429, "TooManyRequests", plainError("TooManyRequests", undefined, "en"), undefined, retryAfter)
    this.name = "EtaBusyError"
  }
}
export class EtaCredentialsError extends EtaError {
  constructor(env: EtaEnv) {
    const names = env === "test" ? "ETA_TEST_CLIENT_ID and ETA_TEST_CLIENT_SECRET" : "ETA_CLIENT_ID and ETA_CLIENT_SECRET"
    super(0, "CredentialsMissing", `The ${env} portal login is not set up. Add ${names} in Vercel.`)
    this.name = "EtaCredentialsError"
  }
}

// ---- fetch that trusts the preprod root CA (plus the default roots). Verification stays on. ----
export type HttpsRequest = typeof httpsRequest

export function caFetch(ca: string, request: HttpsRequest = httpsRequest): FetchFn {
  return (async (input: any, init: any = {}) => {
    const url = new URL(typeof input === "string" ? input : input.url)
    const headers: Record<string, string> = {}
    new Headers(init.headers || {}).forEach((v, k) => { headers[k] = v })
    const body = init.body == null ? undefined : typeof init.body === "string" ? init.body : String(init.body)
    const signal: AbortSignal | undefined = init.signal
    return await new Promise<Response>((resolve, reject) => {
      if (signal?.aborted) return reject(Object.assign(new Error("aborted"), { name: "AbortError" }))
      const req = request(url, { method: init.method || "GET", headers, ca: [...rootCertificates, ca] }, (res) => {
        const chunks: Buffer[] = []
        res.on("data", (c) => chunks.push(c))
        res.on("error", reject)
        res.on("end", () => {
          const h = new Headers()
          for (const [k, v] of Object.entries(res.headers)) if (v != null) h.set(k, Array.isArray(v) ? v.join(", ") : String(v))
          const status = res.statusCode || 0
          const noBody = status === 204 || status === 304
          resolve(new Response(noBody ? null : Buffer.concat(chunks), { status, headers: h }))
        })
      })
      signal?.addEventListener("abort", () => { req.destroy(); reject(Object.assign(new Error("aborted"), { name: "AbortError" })) }, { once: true })
      req.on("error", reject)
      if (body !== undefined) req.write(body)
      req.end()
    })
  }) as FetchFn
}

// Test env: CA-aware fetch with the embedded preprod CA. Real env: plain fetch (default trust only).
export function defaultFetchFor(env: EtaEnv): { fn: FetchFn; ca?: string } {
  return env === "test" ? { fn: caFetch(PREPROD_ROOT_CA), ca: PREPROD_ROOT_CA } : { fn: fetch }
}

export const MAX_RETRY_WAIT_SECONDS = 10
export const REQUEST_TIMEOUT_MS = 30_000

// Retry-After is either whole seconds or an HTTP date.
export function parseRetryAfter(v: string | null, nowMs: number): number | undefined {
  if (!v) return undefined
  const s = v.trim()
  if (/^\d+(\.\d+)?$/.test(s)) return Math.max(Number(s), 0)
  const t = Date.parse(s)
  return Number.isNaN(t) ? undefined : Math.max(Math.ceil((t - nowMs) / 1000), 0)
}

export interface PortalDeps { fetch?: FetchFn; now?: () => number; sleep?: (ms: number) => Promise<void>; timeoutMs?: number }

export interface EtaPortal {
  submit(docsJson: string[]): Promise<{ submissionUUID: string; acceptedDocuments: any[]; rejectedDocuments: any[] }>
  getSubmission(uuid: string): Promise<any>
  getDetails(uuid: string): Promise<any>
  cancel(uuid: string, reason: string): Promise<void>
  searchReceived(p: { from: string; to: string; continuationToken?: string }): Promise<any>
  /** the company's own sent documents with this internal number (to find a send whose answer was lost) */
  searchSent(p: { internalId: string; from: string; to: string }): Promise<any>
  printout(uuid: string): Promise<ArrayBuffer>
  documentType(id: number | string): Promise<any>
  /** one page of the company's approved, active code requests (read-only). SDK: GET /api/v1.0/codetypes/requests/my, query Pn / Ps */
  myCodes(p: { pageNo: number; pageSize: number }): Promise<any>
}

const tokenCache = new Map<string, { token: string; expiresAt: number }>()
export function resetPortalTokens() { tokenCache.clear() }

const MAX_RETRIES = 2

export function createPortal(env: EtaEnv, deps: PortalDeps = {}): EtaPortal {
  const now = deps.now || (() => Date.now())
  const sleep = deps.sleep || ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)))
  const timeoutMs = deps.timeoutMs ?? REQUEST_TIMEOUT_MS
  const doFetch: FetchFn = deps.fetch || defaultFetchFor(env).fn

  // one request with the 429 policy: wait Retry-After, retry twice, then give up
  async function send(url: string, init: RequestInit): Promise<Response> {
    for (let attempt = 0; ; attempt++) {
      const ctl = new AbortController()
      const timer = setTimeout(() => ctl.abort(), timeoutMs)
      let res: Response
      try {
        res = await doFetch(url, { ...init, signal: ctl.signal })
      } catch (e: any) {
        if (ctl.signal.aborted || e?.name === "AbortError")
          throw new EtaError(0, "Timeout", "The ETA portal did not answer in time. Try again in a minute.")
        const code = e?.cause?.code || e?.code || ""
        throw new EtaError(0, "Network", `Could not reach the ETA portal${code ? ` (${code})` : ""}.`)
      } finally {
        clearTimeout(timer)
      }
      if (res.status !== 429) return res
      const secs = parseRetryAfter(res.headers.get("retry-after"), now()) ?? 1
      if (attempt >= MAX_RETRIES || secs > MAX_RETRY_WAIT_SECONDS) throw new EtaBusyError(secs)
      await sleep(secs * 1000)
    }
  }

  async function token(): Promise<string> {
    const cfg = portalConfig(env)
    if (!cfg.clientId || !cfg.clientSecret) throw new EtaCredentialsError(env)
    const key = `${env}:${cfg.clientId}`
    const hit = tokenCache.get(key)
    if (hit && hit.expiresAt > now()) return hit.token
    const basic = Buffer.from(`${cfg.clientId}:${cfg.clientSecret}`).toString("base64")
    const res = await send(`${cfg.idUrl}/connect/token`, {
      method: "POST",
      headers: { Authorization: `Basic ${basic}`, "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
      body: "grant_type=client_credentials&scope=InvoicingAPI",
    })
    const body: any = await res.json().catch(() => ({}))
    if (!res.ok || !body?.access_token) {
      const code = typeof body?.error === "string" ? body.error : body?.error?.code || `HTTP${res.status}`
      throw new EtaError(res.status, code, plainError(code, undefined, "en"))
    }
    const ttl = Number(body.expires_in) > 0 ? Number(body.expires_in) : 3600
    tokenCache.set(key, { token: body.access_token, expiresAt: now() + Math.max(ttl - 60, 1) * 1000 })
    return body.access_token
  }

  async function call(method: string, path: string, opts: { body?: string; accept?: string } = {}): Promise<Response> {
    const cfg = portalConfig(env)
    const tk = await token()
    const headers: Record<string, string> = { Authorization: `Bearer ${tk}`, Accept: opts.accept || "application/json" }
    if (opts.body !== undefined) headers["Content-Type"] = "application/json"
    const res = await send(`${cfg.apiUrl}${path}`, { method, headers, body: opts.body })
    if (res.ok) return res
    const raw: any = await res.json().catch(() => ({}))
    const e = raw?.error && typeof raw.error === "object" ? raw.error : raw
    const code: string = (typeof raw?.error === "string" ? raw.error : e?.code) || `HTTP${res.status}`
    const message: string | undefined = e?.message
    const ra = Number(res.headers.get("retry-after"))
    throw new EtaError(res.status, code, plainError(code, message, "en"), e?.details, Number.isFinite(ra) && ra > 0 ? ra : undefined)
  }

  const json = async (method: string, path: string, body?: string) => {
    const res = await call(method, path, { body })
    const text = await res.text()
    return text ? JSON.parse(text) : {}
  }

  return {
    async submit(docsJson) {
      // documents are already serialized (and signed) text: send them verbatim, never re-stringify
      const b: any = await json("POST", "/api/v1.0/documentsubmissions/", `{"documents":[${docsJson.join(",")}]}`)
      return { ...b, submissionUUID: b.submissionUUID, acceptedDocuments: b.acceptedDocuments || [], rejectedDocuments: b.rejectedDocuments || [] }
    },
    getSubmission: (uuid) => json("GET", `/api/v1.0/documentsubmissions/${encodeURIComponent(uuid)}?pageNo=1&pageSize=100`),
    getDetails: (uuid) => json("GET", `/api/v1.0/documents/${encodeURIComponent(uuid)}/details`),
    async cancel(uuid, reason) {
      await json("PUT", `/api/v1.0/documents/state/${encodeURIComponent(uuid)}/state`, JSON.stringify({ status: "cancelled", reason }))
    },
    searchReceived({ from, to, continuationToken }) {
      const q = new URLSearchParams({ submissionDateFrom: from, submissionDateTo: to, direction: "Received", pageSize: "100" })
      if (continuationToken) q.set("continuationToken", continuationToken)
      return json("GET", `/api/v1.0/documents/search?${q.toString()}`)
    },
    searchSent({ internalId, from, to }) {
      const q = new URLSearchParams({ submissionDateFrom: from, submissionDateTo: to, direction: "Sent", internalID: internalId, pageSize: "100" })
      return json("GET", `/api/v1.0/documents/search?${q.toString()}`)
    },
    async printout(uuid) {
      const res = await call("GET", `/api/v1.0/documents/${encodeURIComponent(uuid)}/pdf`, { accept: "application/pdf" })
      return await res.arrayBuffer()
    },
    myCodes({ pageNo, pageSize }) {
      const q = new URLSearchParams({ Active: "true", Status: "Approved", Pn: String(pageNo), Ps: String(pageSize) })
      return json("GET", `/api/v1.0/codetypes/requests/my?${q.toString()}`)
    },
    documentType: (id) => json("GET", `/api/v1.0/documenttypes/${encodeURIComponent(String(id))}`),
  }
}
