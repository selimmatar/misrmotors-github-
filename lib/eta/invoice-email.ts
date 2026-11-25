// The e-invoice e-mail to the customer (owner request 2026-11-24): once a customer invoice's e-invoice is VALID on the
// ETA portal, a person can e-mail the customer the portal's PDF and signed "view / print" links to the invoice, its
// sales order(s) and its delivery permit(s) (lib/doc-links.ts). Every attempt is a row of invoice_email_log
// (scripts/sql/2026-11-25-invoice-email.sql).
//
// MANUAL ONLY (owner correction 2026-11-26): nothing is ever e-mailed automatically - not when the portal says valid,
// not from the follow-up, not from the daily job. The only way an invoice e-mail goes out is a person pressing "Send"
// (first time) / "Send again" in the invoice's e-invoice window (POST /api/eta/invoice-email). Credit notes are never
// e-mailed (there is no valid invoice document to send).
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
/** A "sending" row older than this was cut off: shown as failed. */
export const SENDING_STALE_MS = 15 * 60_000
export const MAX_RECIPIENTS = 10
export const DEFAULT_FROM_NAME = "Misr Motors | مصر للمحركات"
/** All attachments together stay under this (Gmail takes 25 MB, base64 adds a third): the rest is linked. */
export const MAX_ATTACHMENT_BYTES = 18 * 1024 * 1024

export type EmailStatus = "sent" | "failed" | "no_email" | "not_configured"
/** "auto" only on log rows written before the e-mail became manual-only; every new row is "manual". */
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
  /** only the shipping team's SIGNED copy is sent: attached, linked (too big: its file addresses), not uploaded, or failed */
  permits: { number: string; signed?: { state: SignedCopy["state"]; urls: string[] } }[]
}

const money = (n: number) => n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })

export function invoiceEmailSubject(invoiceNumber: string): string {
  return `فاتورة رقم ${invoiceNumber} — مصر للمحركات`
}

/**
 * Formal Arabic with English beside it, laid out as: greeting, one short paragraph, the invoice details, what is
 * attached, the links, closing. Delivery permits appear only as their SIGNED copy (owner request 2026-11-25): attached,
 * or linked when too big for the e-mail; a permit with no signed copy uploaded is not mentioned.
 */
export function buildInvoiceEmail(c: InvoiceEmailContent): { subject: string; text: string; html: string } {
  const subject = invoiceEmailSubject(c.invoiceNumber)
  const details: { ar: string; en: string; value: string }[] = [
    { ar: "رقم الفاتورة", en: "Invoice No.", value: c.invoiceNumber },
    { ar: "التاريخ", en: "Date", value: c.date },
    { ar: "الإجمالي شاملًا الضريبة", en: "Total incl. VAT", value: `EGP ${money(c.total)}` },
    { ar: "الرقم الإلكتروني (UUID)", en: "ETA UUID", value: c.uuid },
  ]
  const attached: { ar: string; en: string }[] = [{ ar: "الفاتورة الإلكترونية (PDF) من بوابة مصلحة الضرائب", en: "E-invoice (PDF) from the ETA portal" }]
  const links: { ar: string; en: string; url: string }[] = []
  if (c.portalUrl) links.push({ ar: "الفاتورة على بوابة مصلحة الضرائب", en: "E-invoice on the ETA portal", url: c.portalUrl })
  links.push({ ar: "عرض وطباعة الفاتورة", en: "View and print the invoice", url: c.invoiceUrl })
  for (const s of c.salesOrders) links.push({ ar: `أمر البيع ${s.number}`, en: `Sales order ${s.number}`, url: s.url })
  for (const p of c.permits) {
    const st = p.signed?.state
    if (st === "attached") attached.push({ ar: `إذن التسليم ${p.number} موقعًا`, en: `Signed delivery permit ${p.number}` })
    else if (st === "linked" || st === "failed")
      p.signed!.urls.forEach((url, i) => {
        const n = p.signed!.urls.length > 1 ? ` (${i + 1})` : ""
        links.push({ ar: `إذن التسليم ${p.number} موقعًا${n}`, en: `Signed delivery permit ${p.number}${n}`, url })
      })
  }

  const arIntro = `نتشرف بأن نرسل لسيادتكم الفاتورة الإلكترونية رقم ${c.invoiceNumber} بتاريخ ${c.date} بإجمالي ${money(c.total)} جنيه مصري شاملًا ضريبة القيمة المضافة، والمعتمدة على منظومة الفاتورة الإلكترونية بمصلحة الضرائب المصرية.`
  const enIntro = `Please find attached e-invoice No. ${c.invoiceNumber} dated ${c.date}, total EGP ${money(c.total)} incl. VAT, validated on the Egyptian Tax Authority portal.`
  const arValid = `الروابط صالحة لمدة ${DOC_LINK_DAYS} يومًا للعرض والطباعة فقط.`
  const enValid = `Links are valid for ${DOC_LINK_DAYS} days, to view and print only.`

  const plain = [
    `السادة/ ${c.customerName}`,
    "تحية طيبة وبعد،",
    "",
    arIntro,
    enIntro,
    "",
    "بيانات الفاتورة / Invoice details",
    ...details.map((d) => `  ${d.ar} / ${d.en}: ${d.value}`),
    "",
    "المرفقات / Attachments",
    ...attached.map((l) => `  - ${l.ar} / ${l.en}`),
    "",
    "روابط / Links",
    ...links.map((l) => `  - ${l.ar} / ${l.en}:\n    ${l.url}`),
    `  (${arValid} / ${enValid})`,
    "",
    "وتفضلوا بقبول فائق الاحترام،",
    "مصر للمحركات | Misr Motors",
  ].join("\n")

  const e = escapeHtml
  const muted = "color:#6b7280;font-size:13px"
  const enSpan = (s: string) => `<span dir="ltr" style="${muted}">${e(s)}</span>`
  const heading = (ar: string, en: string) =>
    `<tr><td style="padding:20px 24px 6px;font-weight:bold;font-size:15px;color:#0f3d6e">${e(ar)}&nbsp;&nbsp;${enSpan(en)}</td></tr>`
  const html = `<!DOCTYPE html><html lang="ar" dir="rtl"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${e(subject)}</title></head>
<body style="margin:0;padding:0;background:#f3f4f6;font-family:Tahoma,Arial,sans-serif;color:#111827;direction:rtl">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f3f4f6;padding:24px 8px"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;background:#ffffff;border:1px solid #e5e7eb;border-radius:8px;text-align:right;font-size:15px;line-height:1.7">
<tr><td style="background:#0f3d6e;color:#ffffff;padding:16px 24px;border-radius:8px 8px 0 0;font-size:18px;font-weight:bold">مصر للمحركات <span dir="ltr" style="font-weight:normal;font-size:14px;opacity:.85;margin-right:8px">Misr Motors</span></td></tr>
<tr><td style="padding:20px 24px 0">السادة/ ${e(c.customerName)}<br>تحية طيبة وبعد،</td></tr>
<tr><td style="padding:12px 24px 0">${e(arIntro)}<div dir="ltr" style="${muted};text-align:left;margin-top:6px">${e(enIntro)}</div></td></tr>
${heading("بيانات الفاتورة", "Invoice details")}
<tr><td style="padding:0 24px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #e5e7eb;border-radius:6px;border-collapse:separate">
${details
  .map(
    (d, i) =>
      `<tr><td style="padding:8px 12px;${i ? "border-top:1px solid #e5e7eb;" : ""}width:45%;${muted}">${e(d.ar)}<br>${enSpan(d.en)}</td><td dir="ltr" style="padding:8px 12px;${i ? "border-top:1px solid #e5e7eb;" : ""}text-align:left;font-weight:bold;word-break:break-all">${e(d.value)}</td></tr>`,
  )
  .join("\n")}
</table></td></tr>
${heading("المرفقات", "Attachments")}
<tr><td style="padding:0 24px"><ul style="margin:0;padding-right:20px">${attached.map((l) => `<li style="margin-bottom:6px">${e(l.ar)}<br>${enSpan(l.en)}</li>`).join("")}</ul></td></tr>
${heading("روابط", "Links")}
<tr><td style="padding:0 24px"><ul style="margin:0;padding-right:20px">${links
    .map((l) => `<li style="margin-bottom:6px"><a href="${e(l.url)}" style="color:#0f3d6e">${e(l.ar)}</a><br>${enSpan(l.en)}</li>`)
    .join("")}</ul><div style="${muted};margin-top:6px">${e(arValid)}<br>${enSpan(enValid)}</div></td></tr>
<tr><td style="padding:20px 24px 24px">وتفضلوا بقبول فائق الاحترام،<br><strong>مصر للمحركات</strong> ${enSpan("Misr Motors")}</td></tr>
</table></td></tr></table>
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
  | { status: "db_update_needed" | "not_valid" }

const DOC_COLUMNS = "doc_id, invoice_id, document_type, environment, version, status, eta_uuid, eta_long_id, validated_at, document"

/** The newest valid invoice document (never a credit note) of an invoice, on the given portal (any when not given); else its "handled manually" mark when that has a tax portal ID. */
async function validInvoiceDocument(db: Db, invoiceId: number, environment?: EtaEnv): Promise<any | null> {
  const rows = must(await db.from("eta_documents").select(DOC_COLUMNS).eq("invoice_id", invoiceId), "load e-invoice documents") as any[]
  const valid = rows
    .filter((r) => r.document_type !== "C" && r.status === "valid" && text(r.eta_uuid))
    .filter((r) => !environment || (r.environment === "test" ? "test" : "real") === environment)
    .sort((a, b) => (Number(b.version) || 0) - (Number(a.version) || 0) || Number(b.doc_id) - Number(a.doc_id))
  if (valid[0]) return valid[0]
  // an older invoice handled by hand ("already on the portal") with its tax portal ID saved: e-mailed from the real
  // portal by that ID. Without the ID there is nothing to send.
  const manual = rows
    .filter((r) => r.document_type !== "C" && r.status === "manual" && text(r.eta_uuid))
    .sort((a, b) => Number(b.doc_id) - Number(a.doc_id))
  return manual[0] ? { ...manual[0], environment: "real" } : null
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
 * E-mails one invoice's documents to its customer and logs the attempt, on a person's "Send" / "Send again" only (the
 * one caller is POST /api/eta/invoice-email). Without the log table nothing is sent ("db_update_needed"). Never
 * throws for an SMTP or portal failure: those are logged as "failed" with the reason.
 */
export async function sendInvoiceEmail(
  db: Db,
  invoiceId: number,
  opts: { trigger: "manual"; environment?: EtaEnv; userId?: number | null; doc?: any },
  deps: EmailDeps = {},
): Promise<EmailOutcome> {
  if (opts.trigger !== "manual") throw new Error("Invoice e-mails are sent by hand only")
  const d: EmailDeps = { ...invoiceEmailDefaults, ...deps }
  const now = d.now || (() => new Date())
  const doc = opts.doc || (await validInvoiceDocument(db, invoiceId, opts.environment))
  if (!doc) return { status: "not_valid" }
  if (!(await logReady(db))) return { status: "db_update_needed" }
  const uuid = text(doc.eta_uuid)
  const env: EtaEnv = doc.environment === "test" ? "test" : "real"
  const cfg = emailConfig(d.env || process.env)

  const earlier = must(await db.from(EMAIL_LOG_TABLE).select("log_id").eq("invoice_id", invoiceId).eq("eta_uuid", uuid), "read e-mail log") as any[]
  const attempt = earlier.length + 1
  const base = {
    invoice_id: invoiceId,
    eta_uuid: uuid,
    environment: env,
    trigger: "manual" as const,
    attempt,
    created_by: opts.userId ?? null,
    created_at: now().toISOString(),
  }
  if (!cfg.ok) {
    must(await db.from(EMAIL_LOG_TABLE).insert({ ...base, status: "not_configured", error: `Not set: ${cfg.missing.join(", ")}` }), "log e-mail")
    return { status: "not_configured", error: `Not set: ${cfg.missing.join(", ")}` }
  }

  const claim = await db.from(EMAIL_LOG_TABLE).insert({ ...base, status: "sending", claim_key: null }).select("log_id")
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
        return { number: text(p.permit_no) || `#${p.permit_id}`, ...(c ? { signed: { state: c.state, urls: c.urls } } : {}) }
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

// ---- what the invoice window shows ----

export interface InvoiceEmailView {
  /** EMAIL_* / DOC_LINK_SECRET are set */
  configured: boolean
  /** when not configured: the NAMES of the settings that are missing or not valid (never a value) */
  missing?: string[]
  /** the invoice_email_log table exists */
  dbReady: boolean
  last: { status: EmailStatus | "sending"; to: string | null; error: string | null; at: string | null; trigger: EmailTrigger } | null
}

/** The newest e-mail attempt of an invoice (a "sending" row older than 15 minutes counts as failed). Never throws. */
export async function invoiceEmailView(db: Db, invoiceId: number, deps: EmailDeps = {}): Promise<InvoiceEmailView> {
  const d: EmailDeps = { ...invoiceEmailDefaults, ...deps }
  const cfg = emailConfig(d.env || process.env)
  const configured = cfg.ok
  const extra = cfg.ok ? {} : { missing: cfg.missing }
  try {
    const r = await db.from(EMAIL_LOG_TABLE).select("log_id, status, sent_to, error, sent_at, created_at, trigger").eq("invoice_id", invoiceId)
    if (r.error) return { configured, ...extra, dbReady: !isMissingRelation(r.error), last: null }
    const row = [...((r.data as any[]) || [])].sort((a, b) => Number(b.log_id) - Number(a.log_id))[0]
    if (!row) return { configured, ...extra, dbReady: true, last: null }
    const now = (d.now || (() => new Date()))().getTime()
    const stale = row.status === "sending" && now - (Date.parse(text(row.created_at)) || 0) > SENDING_STALE_MS
    return {
      configured,
      ...extra,
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
    return { configured, ...extra, dbReady: false, last: null }
  }
}
