// Signed, read-only links to ONE printed document (the customer invoice, a sales order or a delivery permit), for the
// e-invoice e-mail to the customer. A link opens /api/doc-link/<token> without a login and shows only the print of
// the document it was made for, until it expires (180 days). The token is
//   v1.<kind>.<id>.<expires, unix seconds>.<HMAC-SHA256(DOC_LINK_SECRET, "doc-link:v1:<kind>.<id>.<expires>"), base64url>
// so changing the kind, the id or the date breaks the signature. The secret lives only in the server's env.
import { createHmac, timingSafeEqual } from "node:crypto"

export const DOC_LINK_KINDS = ["invoice", "sales-order", "delivery-permit"] as const
export type DocLinkKind = (typeof DOC_LINK_KINDS)[number]
export const DOC_LINK_DAYS = 180
/** A shorter secret is treated as not set. */
export const DOC_LINK_SECRET_MIN = 32
export const DOC_LINK_PATH = "/api/doc-link/"

export function docLinkSecret(env: Record<string, string | undefined> = process.env): string | null {
  const s = String(env.DOC_LINK_SECRET || "")
  return s.length >= DOC_LINK_SECRET_MIN ? s : null
}

const sign = (secret: string, body: string) => createHmac("sha256", secret).update(`doc-link:v1:${body}`).digest("base64url")

export function signDocLink(kind: DocLinkKind, id: number, secret: string, now: Date = new Date(), days = DOC_LINK_DAYS): string {
  if (!DOC_LINK_KINDS.includes(kind) || !Number.isSafeInteger(id) || id < 1) throw new Error("Invalid document for a link")
  const expires = Math.floor(now.getTime() / 1000) + days * 86_400
  const body = `${kind}.${id}.${expires}`
  return `v1.${body}.${sign(secret, body)}`
}

export function docLinkUrl(baseUrl: string, kind: DocLinkKind, id: number, secret: string, now?: Date): string {
  return `${baseUrl.replace(/\/+$/, "")}${DOC_LINK_PATH}${signDocLink(kind, id, secret, now)}`
}

export type DocLinkCheck = { ok: true; kind: DocLinkKind; id: number } | { ok: false; reason: "invalid" | "expired" | "not_configured" }

/** Checks a token: the signature first (constant time), then the expiry. Anything malformed is "invalid". */
export function verifyDocLink(token: string, secret: string | null, now: Date = new Date()): DocLinkCheck {
  if (!secret) return { ok: false, reason: "not_configured" }
  const m = /^v1\.(invoice|sales-order|delivery-permit)\.([1-9]\d{0,14})\.(\d{1,12})\.([A-Za-z0-9_-]{43})$/.exec(String(token || ""))
  if (!m) return { ok: false, reason: "invalid" }
  const body = `${m[1]}.${m[2]}.${m[3]}`
  const want = Buffer.from(sign(secret, body))
  const got = Buffer.from(m[4])
  if (want.length !== got.length || !timingSafeEqual(want, got)) return { ok: false, reason: "invalid" }
  if (Number(m[3]) * 1000 <= now.getTime()) return { ok: false, reason: "expired" }
  return { ok: true, kind: m[1] as DocLinkKind, id: Number(m[2]) }
}
