// "Send to customer" for quotations and sales orders (owner request 2026-11-27). MANUAL ONLY: nothing is e-mailed
// unless a person presses Send in the document's Send window (POST /api/document-email). The e-mail carries the
// document as a PDF (made from the same print page staff use, lib/pdf/html-to-pdf.ts) and goes to the addresses the
// person confirmed: by default the customer's purchasing contact (customers.salesperson_email) and main e-mail.
// Every Send is one row of document_email_log (scripts/sql/2026-11-27-document-email.sql).
// Sender, logo and settings: the same Gmail account and env as the invoice e-mail (lib/eta/invoice-email.ts).
import { escapeHtml } from "../html-escape"
import { isMissingRelation } from "../po-bill"
import { docLinkUrl } from "../doc-links"
import { gmailTransport, type MailMessage, type MailTransport } from "./smtp"
import { defaultLoadLogo, emailConfig, emailList, LOGO_CID, MAX_RECIPIENTS, type EmailEnvVars } from "../eta/invoice-email"
import { urlToPdf, type UrlToPdf } from "../pdf/html-to-pdf"

type Db = any
export type DocKind = "quotation" | "sales-order"
export const DOC_KINDS: readonly DocKind[] = ["quotation", "sales-order"]
export const DOC_EMAIL_LOG = "document_email_log"

export interface DocEmailDeps {
  transport?: MailTransport
  env?: EmailEnvVars
  /** makes the PDF from the document's signed print link (tests inject a fake) */
  toPdf?: UrlToPdf
  loadLogo?: () => Promise<Buffer | null>
  now?: () => Date
}
/** Defaults for the route (tests set fakes here; the app leaves it empty). */
export const docEmailDefaults: DocEmailDeps = {}

const text = (v: unknown) => (v == null ? "" : String(v).trim())
const money = (n: number) => (Number(n) || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const must = (result: any, what: string): any => {
  if (result.error) throw new Error(`${what}: ${result.error.message || result.error}`)
  return result.data
}
function cairoDate(iso: string): string {
  const ms = Date.parse(iso)
  if (!iso || Number.isNaN(ms)) return ""
  return new Date(ms).toLocaleDateString("en-GB", { day: "2-digit", month: "2-digit", year: "numeric", timeZone: "Africa/Cairo" })
}

export interface DocFacts {
  kind: DocKind
  id: number
  number: string
  customerName: string
  date: string
  total: number
  customerPo: string
  /** the customer's purchasing contact(s), then the main e-mail: what the Send window suggests */
  suggested: string[]
}

/** The document's number, customer, date, total and the suggested recipients; null when it does not exist. */
export async function docFacts(db: Db, kind: DocKind, id: number): Promise<DocFacts | null> {
  const row =
    kind === "quotation"
      ? must(await db.from("sales_quotations").select("*").eq("id", id).maybeSingle(), "load quotation")
      : must(await db.from("sales_orders").select("*").eq("so_id", id).maybeSingle(), "load sales order")
  if (!row) return null
  let customer: any = null
  if (row.customer_id) {
    const r = await db.from("customers").select("*").eq("customer_id", row.customer_id).maybeSingle()
    if (!r.error) customer = r.data
  }
  const suggested = emailList([customer?.salesperson_email, customer?.email || (kind === "quotation" ? row.customer_email : "")].filter(Boolean).join(","))
  return {
    kind,
    id,
    number: text(kind === "quotation" ? row.quotation_number : row.so_number) || `#${id}`,
    customerName: text(customer?.customer_name) || text(row.customer_name),
    date: cairoDate(text(kind === "quotation" ? row.created_at : row.order_date || row.created_at)),
    total: Number(row.total) || 0,
    customerPo: kind === "sales-order" ? text(row.customer_po) : "",
    suggested,
  }
}

const NAMES: Record<DocKind, { ar: string; en: string; file: string }> = {
  quotation: { ar: "عرض السعر", en: "Quotation", file: "quotation" },
  "sales-order": { ar: "أمر البيع", en: "Sales order", file: "sales-order" },
}

export function docEmailSubject(kind: DocKind, number: string): string {
  return kind === "quotation" ? `عرض سعر رقم ${number} — مصر للمحركات` : `أمر بيع رقم ${number} — مصر للمحركات`
}

/** Formal Arabic with English beside it: greeting, one paragraph, the details, the attachment, closing. */
export function buildDocEmail(f: DocFacts, logoCid?: string): { subject: string; text: string; html: string } {
  const n = NAMES[f.kind]
  const subject = docEmailSubject(f.kind, f.number)
  const details: { ar: string; en: string; value: string }[] = [
    { ar: f.kind === "quotation" ? "رقم العرض" : "رقم أمر البيع", en: f.kind === "quotation" ? "Quotation No." : "Sales order No.", value: f.number },
    ...(f.date ? [{ ar: "التاريخ", en: "Date", value: f.date }] : []),
    ...(f.customerPo ? [{ ar: "رقم أمر الشراء الخاص بكم", en: "Your PO No.", value: f.customerPo }] : []),
    { ar: "الإجمالي شاملًا الضريبة", en: "Total incl. VAT", value: `EGP ${money(f.total)}` },
  ]
  const arIntro =
    f.kind === "quotation"
      ? `نتشرف بأن نرسل لسيادتكم عرض السعر رقم ${f.number} بإجمالي ${money(f.total)} جنيه مصري شاملًا ضريبة القيمة المضافة، ونأمل أن ينال رضاكم.`
      : `نتشرف بأن نرسل لسيادتكم أمر البيع رقم ${f.number} بإجمالي ${money(f.total)} جنيه مصري شاملًا ضريبة القيمة المضافة، تأكيدًا لطلبكم.`
  const enIntro =
    f.kind === "quotation"
      ? `Please find attached quotation No. ${f.number}, total EGP ${money(f.total)} incl. VAT.`
      : `Please find attached sales order No. ${f.number}, total EGP ${money(f.total)} incl. VAT, confirming your order.`
  const attachedAr = `${n.ar} (PDF)`
  const attachedEn = `${n.en} (PDF)`
  const plain = [
    `السادة/ ${f.customerName}`,
    "تحية طيبة وبعد،",
    "",
    arIntro,
    enIntro,
    "",
    "البيانات / Details",
    ...details.map((d) => `  ${d.ar} / ${d.en}: ${d.value}`),
    "",
    "المرفقات / Attachments",
    `  - ${attachedAr} / ${attachedEn}`,
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
<tr><td style="padding:16px 24px;border-bottom:4px solid #0f3d6e;border-radius:8px 8px 0 0"><table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
<td style="font-size:20px;font-weight:bold;color:#0f3d6e;vertical-align:middle">مصر للمحركات<br><span dir="ltr" style="font-weight:normal;font-size:14px;color:#6b7280">Misr Motors</span></td>
${logoCid ? `<td width="72" style="text-align:left;vertical-align:middle"><img src="cid:${e(logoCid)}" width="72" height="72" alt="Misr Motors" style="display:block;border:0;width:72px;height:72px"></td>` : ""}
</tr></table></td></tr>
<tr><td style="padding:20px 24px 0">السادة/ ${e(f.customerName)}<br>تحية طيبة وبعد،</td></tr>
<tr><td style="padding:12px 24px 0">${e(arIntro)}<div dir="ltr" style="${muted};text-align:left;margin-top:6px">${e(enIntro)}</div></td></tr>
${heading("البيانات", "Details")}
<tr><td style="padding:0 24px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #e5e7eb;border-radius:6px;border-collapse:separate">
${details
  .map(
    (d, i) =>
      `<tr><td style="padding:8px 12px;${i ? "border-top:1px solid #e5e7eb;" : ""}width:45%;${muted}">${e(d.ar)}<br>${enSpan(d.en)}</td><td dir="ltr" style="padding:8px 12px;${i ? "border-top:1px solid #e5e7eb;" : ""}text-align:left;font-weight:bold;word-break:break-all">${e(d.value)}</td></tr>`,
  )
  .join("\n")}
</table></td></tr>
${heading("المرفقات", "Attachments")}
<tr><td style="padding:0 24px"><ul style="margin:0;padding-right:20px"><li>${e(attachedAr)}<br>${enSpan(attachedEn)}</li></ul></td></tr>
<tr><td style="padding:20px 24px 24px">وتفضلوا بقبول فائق الاحترام،<br><strong>مصر للمحركات</strong> ${enSpan("Misr Motors")}</td></tr>
</table></td></tr></table>
</body></html>`
  return { subject, text: plain, html }
}

async function logReady(db: Db): Promise<boolean> {
  const r = await db.from(DOC_EMAIL_LOG).select("log_id").limit(1)
  if (!r.error) return true
  if (isMissingRelation(r.error)) return false
  throw new Error(`read e-mail log: ${r.error.message || r.error}`)
}

export type DocEmailOutcome =
  | { status: "sent"; to: string[]; logId: number }
  | { status: "failed"; error: string; to?: string[]; logId?: number }
  | { status: "not_configured"; error: string }
  | { status: "no_email" }
  | { status: "not_found" }
  | { status: "db_update_needed" }

/** Sends the document to `to` (the addresses the person confirmed). Manual only: called by the Send button. */
export async function sendDocEmail(
  db: Db,
  kind: DocKind,
  id: number,
  opts: { to: unknown; userId?: number | null },
  deps: DocEmailDeps = {},
): Promise<DocEmailOutcome> {
  const d: DocEmailDeps = { ...docEmailDefaults, ...deps }
  const now = d.now || (() => new Date())
  const facts = await docFacts(db, kind, id)
  if (!facts) return { status: "not_found" }
  if (!(await logReady(db))) return { status: "db_update_needed" }
  const to = emailList(Array.isArray(opts.to) ? opts.to.join(",") : opts.to)
  const earlier = must(await db.from(DOC_EMAIL_LOG).select("log_id").eq("doc_kind", kind).eq("doc_id", id), "read e-mail log") as any[]
  const base = { doc_kind: kind, doc_id: id, attempt: earlier.length + 1, created_by: opts.userId ?? null, created_at: now().toISOString() }
  const cfg = emailConfig(d.env || process.env)
  if (!cfg.ok) {
    const error = `Not set: ${cfg.missing.join(", ")}`
    must(await db.from(DOC_EMAIL_LOG).insert({ ...base, status: "not_configured", error }), "log e-mail")
    return { status: "not_configured", error }
  }
  if (!to.length) {
    must(await db.from(DOC_EMAIL_LOG).insert({ ...base, status: "no_email", error: "No e-mail address." }), "log e-mail")
    return { status: "no_email" }
  }
  const claim = await db.from(DOC_EMAIL_LOG).insert({ ...base, status: "sending", sent_to: to.join(", ") }).select("log_id")
  if (claim.error) throw new Error(`log e-mail: ${claim.error.message || claim.error}`)
  const logId = Number((Array.isArray(claim.data) ? claim.data[0] : claim.data)?.log_id)
  const finish = async (patch: Record<string, any>) => must(await db.from(DOC_EMAIL_LOG).update(patch).eq("log_id", logId), "save e-mail result")
  const hide = (s: string) => (cfg.pass ? s.split(cfg.pass).join("***") : s).slice(0, 500)
  try {
    let pdf: Buffer
    try {
      pdf = await (d.toPdf || urlToPdf)(docLinkUrl(cfg.baseUrl, kind, id, cfg.secret, now()))
    } catch (e: any) {
      const error = hide(`The PDF could not be made: ${e?.message || e}`)
      await finish({ status: "failed", error })
      return { status: "failed", error, to, logId }
    }
    const logo = await (d.loadLogo ? d.loadLogo() : defaultLoadLogo(cfg.baseUrl)).catch(() => null)
    const content = buildDocEmail(facts, logo ? LOGO_CID : undefined)
    const safeNo = facts.number.replace(/[^A-Za-z0-9._-]/g, "_")
    const message: MailMessage = {
      from: { name: cfg.fromName, address: cfg.user },
      to,
      bcc: cfg.bcc.filter((b) => !to.includes(b)),
      ...content,
      attachments: [
        ...(logo ? [{ filename: "misr-motors-logo.png", content: logo, contentType: "image/png", cid: LOGO_CID }] : []),
        { filename: `${NAMES[kind].file}-${safeNo}.pdf`, content: pdf, contentType: "application/pdf" },
      ],
    }
    try {
      await (d.transport || gmailTransport({ user: cfg.user, pass: cfg.pass })).send(message)
    } catch (e: any) {
      const error = hide(`The e-mail could not be sent: ${e?.message || e}`)
      console.error(`[email] ${kind} ${id}: ${error}`)
      await finish({ status: "failed", error })
      return { status: "failed", error, to, logId }
    }
    await finish({ status: "sent", error: null, sent_at: now().toISOString() })
    return { status: "sent", to, logId }
  } catch (e: any) {
    const error = hide(String(e?.message || e))
    console.error(`[email] ${kind} ${id} failed: ${error}`)
    await finish({ status: "failed", error }).catch(() => undefined)
    return { status: "failed", error, logId }
  }
}

export interface DocEmailView {
  dbReady: boolean
  configured: boolean
  number: string
  customerName: string
  suggested: string[]
  maxRecipients: number
  history: { status: string; sentTo: string; at: string; error: string | null }[]
}

/** What the Send window shows: who it would go to, and every earlier Send (newest first). */
export async function docEmailView(db: Db, kind: DocKind, id: number, deps: DocEmailDeps = {}): Promise<DocEmailView | null> {
  const d: DocEmailDeps = { ...docEmailDefaults, ...deps }
  const facts = await docFacts(db, kind, id)
  if (!facts) return null
  const ready = await logReady(db)
  const rows = ready ? (must(await db.from(DOC_EMAIL_LOG).select("*").eq("doc_kind", kind).eq("doc_id", id), "read e-mail log") as any[]) : []
  return {
    dbReady: ready,
    configured: emailConfig(d.env || process.env).ok,
    number: facts.number,
    customerName: facts.customerName,
    suggested: facts.suggested,
    maxRecipients: MAX_RECIPIENTS,
    history: rows
      .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)) || Number(b.log_id) - Number(a.log_id))
      .map((r) => ({ status: String(r.status), sentTo: text(r.sent_to), at: text(r.sent_at || r.created_at), error: r.error ?? null })),
  }
}
