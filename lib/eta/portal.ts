// The only module that talks to the ETA portal. Secrets come from env vars and never appear in errors or logs.
import { existsSync, readFileSync } from "node:fs"
import { request as httpsRequest } from "node:https"
import { join } from "node:path"
import { plainError } from "./portal-errors"

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

// ---- preprod root CA (optional file; the test hosts need it, nothing else uses it) ----
export function loadPreprodCa(): string | null {
  for (const p of [join(process.cwd(), "lib/eta/preprod-root-ca.pem"), join(__dirname, "preprod-root-ca.pem")]) {
    try { if (existsSync(p)) return readFileSync(p, "utf8") } catch { /* try next */ }
  }
  return null
}

// fetch-compatible function that trusts the preprod root CA (plus the default roots). Verification stays on.
function caFetch(ca: string): FetchFn {
  return (async (input: any, init: any = {}) => {
    const url = new URL(typeof input === "string" ? input : input.url)
    const headers: Record<string, string> = {}
    new Headers(init.headers || {}).forEach((v, k) => { headers[k] = v })
    const body = init.body == null ? undefined : typeof init.body === "string" ? init.body : String(init.body)
    return await new Promise<Response>((resolve, reject) => {
      const { rootCertificates } = require("node:tls") as typeof import("node:tls")
      const req = httpsRequest(url, { method: init.method || "GET", headers, ca: [...rootCertificates, ca] }, (res) => {
        const chunks: Buffer[] = []
        res.on("data", (c) => chunks.push(c))
        res.on("end", () => {
          const h = new Headers()
          for (const [k, v] of Object.entries(res.headers)) if (v != null) h.set(k, Array.isArray(v) ? v.join(", ") : String(v))
          const status = res.statusCode || 0
          const noBody = status === 204 || status === 304
          resolve(new Response(noBody ? null : Buffer.concat(chunks), { status, headers: h }))
        })
      })
      req.on("error", reject)
      if (body !== undefined) req.write(body)
      req.end()
    })
  }) as FetchFn
}

export interface PortalDeps { fetch?: FetchFn; now?: () => number; sleep?: (ms: number) => Promise<void> }

export interface EtaPortal {
  submit(docsJson: string[]): Promise<{ submissionUUID: string; acceptedDocuments: any[]; rejectedDocuments: any[] }>
  getSubmission(uuid: string): Promise<any>
  getDetails(uuid: string): Promise<any>
  cancel(uuid: string, reason: string): Promise<void>
  searchReceived(p: { from: string; to: string; continuationToken?: string }): Promise<any>
  printout(uuid: string): Promise<ArrayBuffer>
  documentType(id: number | string): Promise<any>
}

const tokenCache = new Map<string, { token: string; expiresAt: number }>()
export function resetPortalTokens() { tokenCache.clear() }

const MAX_RETRIES = 2

export function createPortal(env: EtaEnv, deps: PortalDeps = {}): EtaPortal {
  const now = deps.now || (() => Date.now())
  const sleep = deps.sleep || ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)))
  let doFetch: FetchFn | undefined = deps.fetch
  const getFetch = (): FetchFn => {
    if (doFetch) return doFetch
    const ca = env === "test" ? loadPreprodCa() : null
    doFetch = ca ? caFetch(ca) : fetch
    return doFetch
  }

  // one request with the 429 policy: wait Retry-After, retry twice, then give up
  async function send(url: string, init: RequestInit): Promise<Response> {
    for (let attempt = 0; ; attempt++) {
      let res: Response
      try {
        res = await getFetch()(url, init)
      } catch (e: any) {
        const code = e?.cause?.code || e?.code || ""
        if (env === "test" && !loadPreprodCa() && /CERT|SELF_SIGNED|ISSUER/.test(String(code)))
          throw new EtaError(0, "TlsTrust", "The test portal certificate is not trusted because lib/eta/preprod-root-ca.pem is missing. Add the portal's preprod root CA file there.")
        throw new EtaError(0, "Network", `Could not reach the ETA portal${code ? ` (${code})` : ""}.`)
      }
      if (res.status !== 429) return res
      const ra = Number(res.headers.get("retry-after"))
      const secs = Number.isFinite(ra) && ra > 0 ? ra : 1
      if (attempt >= MAX_RETRIES) throw new EtaBusyError(secs)
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
    async printout(uuid) {
      const res = await call("GET", `/api/v1.0/documents/${encodeURIComponent(uuid)}/pdf`, { accept: "application/pdf" })
      return await res.arrayBuffer()
    },
    documentType: (id) => json("GET", `/api/v1.0/documenttypes/${encodeURIComponent(String(id))}`),
  }
}
