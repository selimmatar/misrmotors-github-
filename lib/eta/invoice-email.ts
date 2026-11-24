// The e-invoice e-mail to the customer (owner request 2026-11-24): when a customer invoice's e-invoice becomes VALID on
// the real ETA portal, the customer gets one e-mail with the portal's PDF attached and signed "view / print" links to
// the invoice, its sales order(s) and its delivery permit(s) (lib/doc-links.ts). "Send by e-mail again" sends it again
// by hand. Every attempt is a row of invoice_email_log (scripts/sql/2026-11-25-invoice-email.sql).
//
// Once only: an automatic e-mail first claims its row with claim_key "auto:<invoice>:<uuid>:<attempt>" (unique), so two
// requests that see the same valid document can't both send. A refused SMTP send (or a portal PDF that is not ready)
// is retried automatically at most 3 times in all, at least 10 minutes apart (follow-up and the daily job). A row left
// at "sending" (the function was cut off mid-send) is never retried by itself: it may have gone out.
// Credit notes are never e-mailed. Test-portal documents are e-mailed only by hand.
// Sender: Gmail SMTP with an App Password, from env only (EMAIL_SMTP_USER, EMAIL_SMTP_PASS, EMAIL_FROM_NAME, EMAIL_BCC).
import { escapeHtml } from "../html-escape"
import { isMissingRelation } from "../po-bill"
import { docLinkSecret, docLinkUrl, DOC_LINK_DAYS } from "../doc-links"
import { gmailTransport, isEmailAddress, type MailMessage, type MailTransport } from "../email/smtp"
import { portalPrintout, type PrintoutDeps } from "./after-send"
import type { EtaEnv } from "./portal"
import { storedBody } from "./send"
import { defaultFetchFile, fitAttachments, signedPermitCopies, type FetchFile, type SignedCopy } from "./signed-permits"

type Db = any

export const EMAIL_LOG_TABLE = "invoice_email_log"
export const AUTO_MAX_ATTEMPTS = 3
export const AUTO_RETRY_AFTER_MS = 10 * 60_000
/** Company setting: automatic e-mails only for documents valid from this moment on (ISO time). */
export const AUTO_FROM_KEY = "invoice_email_auto_from"
/** Valid documents are looked at for this many days after they became valid (retries and missed sends). */
export const AUTO_WINDOW_DAYS = 3
/** A "sending" row older than this was cut off: shown as failed, never retried by itself. */
export const SENDING_STALE_MS = 15 * 60_000
export const MAX_RECIPIENTS = 10
export const DEFAULT_FROM_NAME = "Misr Motors | مصر للمحركات"
/** All attachments together stay under this (Gmail takes 25 MB, base64 adds a third): the rest is linked. */
export const MAX_ATTACHMENT_BYTES = 18 * 1024 * 1024

export type EmailStatus = "sent" | "failed" | "no_email" | "not_configured"
export type EmailTrigger = "auto" | "manual"
export type EmailEnvVars = Record<string, string | undefined>

export interface EmailDeps extends PrintoutDeps {
  /** the mail transport (tests inject a fake; the app uses Gmail SMTP) */
  transport?: MailTransport
  /** env vars to read the configuration from (tests); default process.env */
  env?: EmailEnvVars
  /** downloads a signed delivery-permit upload (tests inject a fake) */
  fetchFile?: FetchFile
}
/** Defaults for the routes and the follow-up (tests set a fake transport / env here; the app leaves it empty). */
export const invoiceEmailDefaults: EmailDeps = {}

const text = (v: unknown) => (v == null ? "" : String(v).trim())
const must = (result: any, what: string): any => {
  if (result.error) throw new Error(`${what}: ${result.error.message || result.error}`)
  return result.data
}

// ---- configuration (env only) ----

export type EmailConfig =
  | { ok: true; user: string; pass: string; fromName: string; bcc: string[]; secret: string; baseUrl: string }
  | { ok: false; missing: string[] }

/** The app's public address for the links: APP_BASE_URL, else Vercel's production domain, else the deployment's. */
export function appBaseUrl(env: EmailEnvVars): string | null {
  const raw = text(env.APP_BASE_URL) || text(env.VERCEL_PROJECT_PRODUCTION_URL) || text(env.VERCEL_URL)
  if (!raw) return null
  const url = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`
  try {
    const u = new URL(url)
    return `${u.protocol}//${u.host}`
  } catch {
    return null
  }
}

/** Splits "a@x.com, b@y.com; c@z.com" into valid addresses (lower case, no repeats, at most 10). */
export function emailList(raw: unknown): string[] {
  const out: string[] = []
  for (const part of text(raw).split(/[,;\s]+/)) {
    const a = part.trim().toLowerCase()
    if (a && isEmailAddress(a) && !out.includes(a)) out.push(a)
  }
  return out.slice(0, MAX_RECIPIENTS)
}

/** What the e-mail needs from env; `missing` lists only variable NAMES (never a value). */
export function emailConfig(env: EmailEnvVars = process.env): EmailConfig {
  const user = text(env.EMAIL_SMTP_USER)
  const pass = String(env.EMAIL_SMTP_PASS || "").replace(/\s+/g, "") // Google shows app passwords in groups of 4
  const secret = docLinkSecret(env)
  const baseUrl = appBaseUrl(env)
  const missing: string[] = []
  if (!isEmailAddress(user)) missing.push("EMAIL_SMTP_USER")
  if (!pass) missing.push("EMAIL_SMTP_PASS")
  if (!secret) missing.push("DOC_LINK_SECRET")
  if (!baseUrl) missing.push("APP_BASE_URL")
  if (missing.length || !secret || !baseUrl) return { ok: false, missing }
  return { ok: true, user, pass, fromName: text(env.EMAIL_FROM_NAME) || DEFAULT_FROM_NAME, bcc: emailList(env.EMAIL_BCC), secret, baseUrl }
}

// ---- the message ----

export interface InvoiceEmailContent {
  customerName: string
  invoiceNumber: string
  /** dd/mm/yyyy */
  date: string
  total: number
  uuid: string
  /** the portal's public page of the document, when its long id is known */
  portalUrl: string | null
  invoiceUrl: string
  salesOrders: { number: string; url: string }[]
  /** signed: the shipping team's signed copy - attached, linked (too big: its file addresses), not uploaded, or failed */
  permits: { number: string; url: string; signed?: { state: SignedCopy["state"]; urls: string[] } }[]
}

const money = (n: number) => n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })

export function invoiceEmailSubject(invoiceNumber: string): string {
  return `فاتورة رقم ${invoiceNumber} — مصر للمحركات`
}

/** Formal Arabic, short, with one English line under each part. */
export function buildInvoiceEmail(c: InvoiceEmailContent): { subject: string; text: string; html: string } {
  const subject = invoiceEmailSubject(c.invoiceNumber)
  const links: { ar: string; en: string; url: string }[] = []
  if (c.portalUrl) links.push({ ar: "الفاتورة الإلكترونية على بوابة مصلحة الضرائب", en: "E-invoice on the ETA portal", url: c.portalUrl })
  links.push({ ar: "الفاتورة", en: "Invoice", url: c.invoiceUrl })
  for (const s of c.salesOrders) links.push({ ar: `أمر البيع ${s.number}`, en: `Sales order ${s.number}`, url: s.url })
  for (const p of c.permits) links.push({ ar: `إذن التسليم ${p.number}`, en: `Delivery permit ${p.number}`, url: p.url })
  // the signed copies: attached, or linked when too big, or a note when the shipping team has not uploaded one
  const signedLines: { ar: string; en: string; url?: string }[] = []
  for (const p of c.permits) {
    const st = p.signed?.state
    if (st === "attached") signedLines.push({ ar: `النسخة الموقعة من إذن التسليم ${p.number} مرفقة.`, en: `Signed copy of delivery permit ${p.number}: attached.` })
    else if (st === "not_uploaded") signedLines.push({ ar: `النسخة الموقعة من إذن التسليم ${p.number} لم تُرفع بعد.`, en: `Delivery permit ${p.number}: signed copy not uploaded.` })
    else if (st === "linked" || st === "failed")
      p.signed!.urls.forEach((url, i) =>
        signedLines.push({ ar: `النسخة الموقعة من إذن التسليم ${p.number}${p.signed!.urls.length > 1 ? ` (${i + 1})` : ""}`, en: `Signed copy of delivery permit ${p.number}`, url }),
      )
  }

  const arIntro = `نتشرف بأن نرسل لسيادتكم الفاتورة الإلكترونية رقم ${c.invoiceNumber} بتاريخ ${c.date} بإجمالي ${money(c.total)} جنيه مصري شاملًا ضريبة القيمة المضافة، والمعتمدة على منظومة الفاتورة الإلكترونية بمصلحة الضرائب المصرية. مرفق نسخة الفاتورة (PDF) من البوابة.`
  const enIntro = `Please find attached e-invoice No. ${c.invoiceNumber} dated ${c.date}, total EGP ${money(c.total)} incl. VAT, validated on the Egyptian Tax Authority portal.`
  const arValid = `الروابط صالحة لمدة ${DOC_LINK_DAYS} يومًا للعرض والطباعة فقط.`
  const enValid = `The links are valid for ${DOC_LINK_DAYS} days, to view and print only.`

  const plain = [
    `السادة/ ${c.customerName}`,
    "تحية طيبة وبعد،",
    "",
    arIntro,
    enIntro,
    "",
    `الرقم الإلكتروني للفاتورة (UUID): ${c.uuid}`,
    `ETA UUID: ${c.uuid}`,
    "",
    "المستندات / Documents:",
    ...links.map((l) => `- ${l.ar} / ${l.en}: ${l.url}`),
    ...signedLines.map((l) => (l.url ? `- ${l.ar} / ${l.en}: ${l.url}` : `- ${l.ar} / ${l.en}`)),
    "",
    arValid,
    enValid,
    "",
    "وتفضلوا بقبول فائق الاحترام،",
    "مصر للمحركات",
    "Misr Motors",
  ].join("\n")

  const e = escapeHtml
  const en = (s: string) => `<div dir="ltr" style="color:#555;font-size:13px;text-align:left">${e(s)}</div>`
  const html = `<!DOCTYPE html><html lang="ar" dir="rtl"><head><meta charset="UTF-8"><title>${e(subject)}</title></head>
<body style="font-family:Tahoma,Arial,sans-serif;font-size:15px;line-height:1.7;color:#111;direction:rtl;text-align:right">
<p>السادة/ ${e(c.customerName)}<br>تحية طيبة وبعد،</p>
<p>${e(arIntro)}</p>${en(enIntro)}
<p>الرقم الإلكتروني للفاتورة (UUID): <span dir="ltr">${e(c.uuid)}</span></p>
<p style="margin-bottom:4px">المستندات / Documents:</p>
<ul>${links.map((l) => `<li><a href="${e(l.url)}">${e(l.ar)}</a> <span dir="ltr" style="color:#555">/ ${e(l.en)}</span></li>`).join("")}${signedLines
    .map((l) => `<li>${l.url ? `<a href="${e(l.url)}">${e(l.ar)}</a>` : e(l.ar)} <span dir="ltr" style="color:#555">/ ${e(l.en)}</span></li>`)
    .join("")}</ul>
<p>${e(arValid)}</p>${en(enValid)}
<p>وتفضلوا بقبول فائق الاحترام،<br>مصر للمحركات<br><span dir="ltr">Misr Motors</span></p>
</body></html>`
  return { subject, text: plain, html }
}

/** The portal's public page of a document (the address in its QR code). */
export function portalShareUrl(env: EtaEnv, uuid: string, longId: string | null): string | null {
  if (!uuid || !longId) return null
  const host = env === "test" ? "https://preprod.invoicing.eta.gov.eg" : "https://invoicing.eta.gov.eg"
  return `${host}/documents/${encodeURIComponent(uuid)}/share/${encodeURIComponent(longId)}`
}

function cairoDate(iso: string): string {
  const d = new Date(iso)
  if (!Number.isFinite(d.getTime())) return ""
  return new Intl.DateTimeFormat("en-GB", { timeZone: "Africa/Cairo", day: "2-digit", month: "2-digit", year: "numeric" }).format(d)
}

// ---- sending ----

export type EmailOutcome =
  | { status: EmailStatus; to?: string[]; error?: string; logId?: number }
  | { status: "db_update_needed" | "not_valid" | "already" }

const DOC_COLUMNS = "doc_id, invoice_id, document_type, environment, version, status, eta_uuid, eta_long_id, validated_at, document"

/** The newest valid invoice document (never a credit note) of an invoice, on the given portal (any when not given). */
async function validInvoiceDocument(db: Db, invoiceId: number, environment?: EtaEnv): Promise<any | null> {
  const rows = must(await db.from("eta_documents").select(DOC_COLUMNS).eq("invoice_id", invoiceId), "load e-invoice documents") as any[]
  const valid = rows
    .filter((r) => r.document_type !== "C" && r.status === "valid" && text(r.eta_uuid))
    .filter((r) => !environment || (r.environment === "test" ? "test" : "real") === environment)
    .sort((a, b) => (Number(b.version) || 0) - (Number(a.version) || 0) || Number(b.doc_id) - Number(a.doc_id))
  return valid[0] || null
}

/** True when the log table exists. */
async function logReady(db: Db): Promise<boolean> {
  const r = await db.from(EMAIL_LOG_TABLE).select("log_id").limit(1)
  if (r.error && isMissingRelation(r.error)) return false
  if (r.error) throw new Error(`read e-mail log: ${r.error.message || r.error}`)
  return true
}

/** Everything the e-mail says, from the invoice, its customer, its delivery permits and the stored e-invoice body. */
async function emailFacts(db: Db, invoiceId: number, doc: any) {
  const inv = must(
    await db.from("accounts_receivable").select("invoice_id, invoice_number, so_id, amount, customer_id, created_at").eq("invoice_id", invoiceId).maybeSingle(),
    "load invoice",
  )
  if (!inv) throw new Error("Invoice not found")
  // the card's "Accountant email" (customers.accountant_email) when the column exists, else only the main e-mail
  let customer: any = null
  if (inv.customer_id) {
    const withAccountant = await db.from("customers").select("customer_id, customer_name, email, accountant_email").eq("customer_id", inv.customer_id).maybeSingle()
    customer = withAccountant.error && isMissingRelation(withAccountant.error)
      ? must(await db.from("customers").select("customer_id, customer_name, email").eq("customer_id", inv.customer_id).maybeSingle(), "load customer")
      : must(withAccountant, "load customer")
  }
  const links = must(await db.from("invoice_delivery_permits").select("permit_id").eq("invoice_id", invoiceId), "load invoice links") as any[]
  const permitIds = [...new Set(links.map((l) => Number(l.permit_id)).filter((n) => Number.isSafeInteger(n) && n > 0))]
  const permits = permitIds.length
    ? (must(await db.from("delivery_permits").select("permit_id, permit_no, sales_order_id").in("permit_id", permitIds), "load delivery permits") as any[])
    : []
  const soIds = [...new Set([...permits.map((p) => Number(p.sales_order_id)), Number(inv.so_id)].filter((n) => Number.isSafeInteger(n) && n > 0))]
  const orders = soIds.length ? (must(await db.from("sales_orders").select("so_id, so_number").in("so_id", soIds), "load sales orders") as any[]) : []
  let body: any = {}
  try {
    body = JSON.parse(storedBody(doc) || "{}")
  } catch {
    body = {}
  }
  const total = Number.isFinite(Number(body.totalAmount)) && body.totalAmount != null ? Number(body.totalAmount) : Number(inv.amount) || 0
  return {
    invoiceNumber: text(inv.invoice_number) || text(body.internalID) || String(invoiceId),
    customerName: text(customer?.customer_name) || text(body?.receiver?.name) || "-",
    // the accountant e-mail(s) when set, else the main e-mail
    recipients: emailList(customer?.accountant_email).length ? emailList(customer?.accountant_email) : emailList(customer?.email),
    date: cairoDate(text(body.dateTimeIssued) || text(inv.created_at)),
    total,
    permits: [...permits].sort((a, b) => Number(a.permit_id) - Number(b.permit_id)),
    orders: [...orders].sort((a, b) => Number(a.so_id) - Number(b.so_id)),
  }
}

/**
 * E-mails one invoice's documents to its customer and logs the attempt. `auto` sends happen once (claim_key); `manual`
 * ("Send by e-mail again") always sends. Without the log table nothing is sent ("db_update_needed"). Never throws for
 * an SMTP or portal failure: those are logged as "failed" with the reason.
 */
export async function sendInvoiceEmail(
  db: Db,
  invoiceId: number,
  opts: { trigger: EmailTrigger; environment?: EtaEnv; userId?: number | null; attempt?: number; doc?: any },
  deps: EmailDeps = {},
): Promise<EmailOutcome> {
  const d: EmailDeps = { ...invoiceEmailDefaults, ...deps }
  const now = d.now || (() => new Date())
  const doc = opts.doc || (await validInvoiceDocument(db, invoiceId, opts.environment))
  if (!doc) return { status: "not_valid" }
  if (!(await logReady(db))) return { status: "db_update_needed" }
  const uuid = text(doc.eta_uuid)
  const env: EtaEnv = doc.environment === "test" ? "test" : "real"
  const cfg = emailConfig(d.env || process.env)

  let attempt = opts.attempt || 1
  if (opts.trigger === "manual") {
    const earlier = must(await db.from(EMAIL_LOG_TABLE).select("log_id").eq("invoice_id", invoiceId).eq("eta_uuid", uuid), "read e-mail log") as any[]
    attempt = earlier.length + 1
  }
  const base = {
    invoice_id: invoiceId,
    eta_uuid: uuid,
    environment: env,
    trigger: opts.trigger,
    attempt,
    created_by: opts.userId ?? null,
    created_at: now().toISOString(),
  }
  if (!cfg.ok) {
    // automatic sends without a configuration are not logged (the invoice shows "E-mail not set up" from env)
    if (opts.trigger === "manual")
      must(await db.from(EMAIL_LOG_TABLE).insert({ ...base, status: "not_configured", error: `Not set: ${cfg.missing.join(", ")}` }), "log e-mail")
    return { status: "not_configured", error: `Not set: ${cfg.missing.join(", ")}` }
  }

  // claim first: a second automatic sender for the same invoice / document / attempt stops here
  const claim = await db
    .from(EMAIL_LOG_TABLE)
    .insert({ ...base, status: "sending", claim_key: opts.trigger === "auto" ? `auto:${invoiceId}:${uuid}:${attempt}` : null })
    .select("log_id")
  if (claim.error?.code === "23505") return { status: "already" }
  if (claim.error) throw new Error(`log e-mail: ${claim.error.message || claim.error}`)
  const logId = Number((Array.isArray(claim.data) ? claim.data[0] : claim.data)?.log_id)
  const finish = async (patch: Record<string, any>) =>
    must(await db.from(EMAIL_LOG_TABLE).update(patch).eq("log_id", logId), "save e-mail result")
  const hide = (s: string) => (cfg.pass ? s.split(cfg.pass).join("***") : s).slice(0, 500)

  try {
    const facts = await emailFacts(db, invoiceId, doc)
    if (!facts.recipients.length) {
      await finish({ status: "no_email", error: "The customer has no e-mail address." })
      return { status: "no_email", logId }
    }
    const pdf = await portalPrintout(db, { docId: doc.doc_id }, d)
    if (!pdf.ok) {
      const error = `The e-invoice PDF could not be downloaded from the portal: ${pdf.message}`
      await finish({ status: "failed", error: hide(error), sent_to: facts.recipients.join(", ") })
      return { status: "failed", error, to: facts.recipients, logId }
    }
    const pdfBytes = Buffer.from(pdf.pdf)
    const copies = fitAttachments(await signedPermitCopies(db, facts.permits, d.fetchFile || defaultFetchFile), MAX_ATTACHMENT_BYTES - pdfBytes.length)
    const copyOf = (permitId: number) => copies.find((c) => c.permitId === permitId)
    const at = now()
    const link = (kind: "invoice" | "sales-order" | "delivery-permit", id: number) => docLinkUrl(cfg.baseUrl, kind, id, cfg.secret, at)
    const content = buildInvoiceEmail({
      customerName: facts.customerName,
      invoiceNumber: facts.invoiceNumber,
      date: facts.date,
      total: facts.total,
      uuid,
      portalUrl: portalShareUrl(env, uuid, text(doc.eta_long_id) || null),
      invoiceUrl: link("invoice", invoiceId),
      salesOrders: facts.orders.map((o) => ({ number: text(o.so_number) || `#${o.so_id}`, url: link("sales-order", Number(o.so_id)) })),
      permits: facts.permits.map((p) => {
        const c = copyOf(Number(p.permit_id))
        return { number: text(p.permit_no) || `#${p.permit_id}`, url: link("delivery-permit", Number(p.permit_id)), ...(c ? { signed: { state: c.state, urls: c.urls } } : {}) }
      }),
    })
    const message: MailMessage = {
      from: { name: cfg.fromName, address: cfg.user },
      to: facts.recipients,
      bcc: cfg.bcc.filter((b) => !facts.recipients.includes(b)),
      ...content,
      attachments: [
        { filename: `invoice-${facts.invoiceNumber}.pdf`, content: pdfBytes, contentType: "application/pdf" },
        ...copies.flatMap((c) => c.attachments),
      ],
    }
    try {
      await (d.transport || gmailTransport({ user: cfg.user, pass: cfg.pass })).send(message)
    } catch (e: any) {
      const error = hide(`The e-mail could not be sent: ${e?.message || e}`)
      console.error(`[email] invoice ${invoiceId}: ${error}`)
      await finish({ status: "failed", error, sent_to: facts.recipients.join(", ") })
      return { status: "failed", error, to: facts.recipients, logId }
    }
    await finish({ status: "sent", error: null, sent_to: facts.recipients.join(", "), sent_at: now().toISOString() })
    return { status: "sent", to: facts.recipients, logId }
  } catch (e: any) {
    const error = hide(String(e?.message || e))
    console.error(`[email] invoice ${invoiceId} failed: ${error}`)
    await finish({ status: "failed", error }).catch(() => undefined)
    return { status: "failed", error, logId }
  }
}

/** Whether an automatic e-mail is due for this document, from its log rows; the attempt number when it is. */
export function autoAttemptDue(rows: any[], uuid: string, now: Date): number | null {
  const mine = rows.filter((r) => text(r.eta_uuid) === uuid)
  if (mine.some((r) => r.status === "sent")) return null // sent (automatically or by hand)
  const auto = mine.filter((r) => r.trigger === "auto")
  if (auto.some((r) => r.status === "no_email" || r.status === "sending")) return null
  const failed = auto.filter((r) => r.status === "failed")
  if (auto.length >= AUTO_MAX_ATTEMPTS || failed.length >= AUTO_MAX_ATTEMPTS) return null
  const last = Math.max(0, ...auto.map((r) => Date.parse(text(r.created_at)) || 0))
  if (last && now.getTime() - last < AUTO_RETRY_AFTER_MS) return null
  return Math.max(0, ...auto.map((r) => Number(r.attempt) || 0)) + 1
}

/**
 * The automatic e-mails: real-portal invoice documents that became valid in the last 3 days and have no e-mail yet
 * (or a failed one to retry). At most `max` e-mails per run. Nothing at all happens (not even a read) when the
 * e-mail is not configured. Never throws.
 */
export async function emailValidInvoices(
  db: Db,
  deps: EmailDeps = {},
  opts: { max?: number; stopAt?: () => boolean } = {},
): Promise<{ sent: number; failed: number; noEmail: number; skipped?: "not_configured" | "db_update_needed" }> {
  const out = { sent: 0, failed: 0, noEmail: 0 }
  try {
    const d: EmailDeps = { ...invoiceEmailDefaults, ...deps }
    if (!emailConfig(d.env || process.env).ok) return { ...out, skipped: "not_configured" }
    const now = (d.now || (() => new Date()))()
    let since = new Date(now.getTime() - AUTO_WINDOW_DAYS * 86_400_000).toISOString()
    // Automatic e-mails only for documents that became valid after the feature was switched on (owner, 2026-11-26):
    // older invoices are sent by hand with "Send". The start is the company setting `invoice_email_auto_from`.
    const startRow = await db.from("company_settings").select("setting_value").eq("setting_key", AUTO_FROM_KEY).maybeSingle()
    const autoFrom = Date.parse(String(startRow?.data?.setting_value || ""))
    if (Number.isFinite(autoFrom) && autoFrom > Date.parse(since)) since = new Date(autoFrom).toISOString()
    const docs = (must(
      await db.from("eta_documents").select(DOC_COLUMNS).eq("status", "valid").eq("environment", "real").gte("validated_at", since),
      "load valid documents",
    ) as any[])
      .filter((r) => r.document_type !== "C" && text(r.eta_uuid) && r.invoice_id)
      .sort((a, b) => text(a.validated_at).localeCompare(text(b.validated_at)))
    if (!docs.length) return out
    const logs = await db.from(EMAIL_LOG_TABLE).select("invoice_id, eta_uuid, trigger, status, attempt, created_at").in("invoice_id", [...new Set(docs.map((r) => r.invoice_id))])
    if (logs.error && isMissingRelation(logs.error)) return { ...out, skipped: "db_update_needed" }
    if (logs.error) throw new Error(`read e-mail log: ${logs.error.message || logs.error}`)
    let done = 0
    for (const doc of docs) {
      if (done >= (opts.max ?? 1) || opts.stopAt?.()) break
      const attempt = autoAttemptDue((logs.data as any[]).filter((r) => r.invoice_id === doc.invoice_id), text(doc.eta_uuid), now)
      if (attempt === null) continue
      done++
      const r = await sendInvoiceEmail(db, Number(doc.invoice_id), { trigger: "auto", attempt, doc }, d)
      if (r.status === "sent") out.sent++
      else if (r.status === "failed") out.failed++
      else if (r.status === "no_email") out.noEmail++
    }
  } catch (e: any) {
    console.error(`[email] automatic e-mails failed: ${e?.message || e}`)
  }
  return out
}

// ---- what the invoice window shows ----

export interface InvoiceEmailView {
  /** EMAIL_* / DOC_LINK_SECRET are set */
  configured: boolean
  /** the invoice_email_log table exists */
  dbReady: boolean
  last: { status: EmailStatus | "sending"; to: string | null; error: string | null; at: string | null; trigger: EmailTrigger } | null
}

/** The newest e-mail attempt of an invoice (a "sending" row older than 15 minutes counts as failed). Never throws. */
export async function invoiceEmailView(db: Db, invoiceId: number, deps: EmailDeps = {}): Promise<InvoiceEmailView> {
  const d: EmailDeps = { ...invoiceEmailDefaults, ...deps }
  const configured = emailConfig(d.env || process.env).ok
  try {
    const r = await db.from(EMAIL_LOG_TABLE).select("log_id, status, sent_to, error, sent_at, created_at, trigger").eq("invoice_id", invoiceId)
    if (r.error) return { configured, dbReady: !isMissingRelation(r.error), last: null }
    const row = [...((r.data as any[]) || [])].sort((a, b) => Number(b.log_id) - Number(a.log_id))[0]
    if (!row) return { configured, dbReady: true, last: null }
    const now = (d.now || (() => new Date()))().getTime()
    const stale = row.status === "sending" && now - (Date.parse(text(row.created_at)) || 0) > SENDING_STALE_MS
    return {
      configured,
      dbReady: true,
      last: {
        status: stale ? "failed" : row.status,
        to: text(row.sent_to) || null,
        error: stale ? "Cut off while sending; it may not have gone out." : text(row.error) || null,
        at: text(row.sent_at) || text(row.created_at) || null,
        trigger: row.trigger === "manual" ? "manual" : "auto",
      },
    }
  } catch {
    return { configured, dbReady: false, last: null }
  }
}
