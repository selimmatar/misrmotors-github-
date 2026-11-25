// "Send to customer" for quotations and sales orders (owner request 2026-11-27): manual only, the document as a PDF,
// to the customer's purchasing contact and main e-mail (editable), logged; the quotation print by id; the customer
// card's purchasing contact field. Fake SMTP and a fake PDF maker only.
import { useDb } from "./route-harness"
import test from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { FakeDb } from "./fake-db"
import { buildDocEmail, docEmailDefaults, docFacts, docEmailView, sendDocEmail, type DocEmailDeps } from "../email/document-email"
import { verifyDocLink, signDocLink, DOC_LINK_KINDS } from "../doc-links"
import * as docLinkRoute from "../../app/api/doc-link/[token]/route"
import type { MailMessage, MailTransport } from "../email/smtp"
import { allows, ruleFor } from "../auth/permissions"
import * as route from "../../app/api/document-email/route"
import * as customersRoute from "../../app/api/customers/route"
import * as quotationPrint from "../../app/api/quotations/generate/route"

const REPO = process.env.REPO_ROOT || process.cwd()
const SECRET = "s".repeat(40)
const ENV = {
  EMAIL_SMTP_USER: "misrmotors.invoices@gmail.com",
  EMAIL_SMTP_PASS: "abcd efgh ijkl mnop",
  EMAIL_BCC: "copy@misrmotors.com",
  DOC_LINK_SECRET: SECRET,
  APP_BASE_URL: "https://erp.example.com",
}
const NOW = new Date("2026-11-27T10:00:00Z")

function docDb() {
  const db = new FakeDb({
    users: [{ user_id: 7 }],
    customers: [{ customer_id: 5, customer_name: "Acme Trading", email: "info@acme.com", salesperson_email: "Buyer@Acme.com; second@acme.com" }],
    sales_quotations: [{ id: 3, quotation_number: "Q-2026-003", customer_id: 5, customer_name: "Acme Trading", customer_email: "old@acme.com", created_at: "2026-11-26T22:30:00Z", total: 1140, validity_days: 15 }],
    sales_quotation_items: [{ id: 1, quotation_id: 3, line_no: 1, product_name: "Pump 5HP", quantity: 2, unit_price: 500 }],
    sales_orders: [{ so_id: 9, so_number: "SO-9", customer_id: 5, total: 2280, order_date: "2026-11-25", customer_po: "PO-77", status: "approved" }],
    document_email_log: [],
  })
  db.jitter = false
  return db
}

function fakeMail(fail = false) {
  const sent: MailMessage[] = []
  const transport: MailTransport = {
    async send(m) {
      if (fail) throw new Error("535 bad login abcdefghijklmnop")
      sent.push(m)
      return { messageId: "<m@test>" }
    },
  }
  return { sent, transport }
}

function deps(mail: { transport: MailTransport }, extra: DocEmailDeps = {}) {
  const urls: string[] = []
  const d: DocEmailDeps = {
    env: ENV,
    transport: mail.transport,
    now: () => NOW,
    loadLogo: async () => Buffer.from("PNG"),
    toPdf: async (url) => {
      urls.push(url)
      return Buffer.from("%PDF-1.7 doc")
    },
    ...extra,
  }
  return { d, urls }
}

function rq(method: string, path: string, body?: unknown, role = "sales-rep"): any {
  const url = `http://test.local${path}`
  const r = new Request(url, { method, headers: { "content-type": "application/json", "x-mm-roles": role, "x-mm-user-id": "7" }, body: body === undefined ? undefined : JSON.stringify(body) })
  return Object.assign(r, { nextUrl: new URL(url) })
}

const failing = (error: { code: string; message: string }) => {
  const answer = { data: null, error }
  const q: any = new Proxy({}, { get: (_t, k) => (k === "then" ? (ok: any, no: any) => Promise.resolve(answer).then(ok, no) : () => q) })
  return q
}

test("DE1. suggested recipients: the purchasing contact(s) first, then the main e-mail; facts for both kinds", async () => {
  const db = docDb()
  const q = (await docFacts(db, "quotation", 3))!
  assert.deepEqual(q.suggested, ["buyer@acme.com", "second@acme.com", "info@acme.com"])
  assert.equal(q.number, "Q-2026-003")
  assert.equal(q.date, "27/11/2026", "Cairo date")
  assert.equal(q.customerPo, "")
  const so = (await docFacts(db, "sales-order", 9))!
  assert.equal(so.number, "SO-9")
  assert.equal(so.customerPo, "PO-77")
  assert.equal(so.total, 2280)
  // no purchasing contact and no customer e-mail: a quotation falls back to the e-mail typed on it
  db.tables.customers[0].salesperson_email = null
  db.tables.customers[0].email = ""
  assert.deepEqual((await docFacts(db, "quotation", 3))!.suggested, ["old@acme.com"])
  assert.deepEqual((await docFacts(db, "sales-order", 9))!.suggested, [])
  assert.equal(await docFacts(db, "quotation", 99), null)
})

test("DE2. the e-mail: formal Arabic with English, the PO row on a sales order only, the PDF named in the attachments", async () => {
  const db = docDb()
  const so = buildDocEmail((await docFacts(db, "sales-order", 9))!, "logo")
  assert.equal(so.subject, "أمر بيع رقم SO-9 — مصر للمحركات")
  assert.ok(so.text.includes("رقم أمر الشراء الخاص بكم / Your PO No.: PO-77"))
  assert.ok(so.text.includes("أمر البيع (PDF) / Sales order (PDF)"))
  assert.ok(so.html.includes('src="cid:logo"') && so.html.includes('dir="rtl"'))
  const q = buildDocEmail((await docFacts(db, "quotation", 3))!)
  assert.equal(q.subject, "عرض سعر رقم Q-2026-003 — مصر للمحركات")
  assert.ok(!q.text.includes("Your PO No."))
  assert.ok(q.text.includes("EGP 1,140.00") && !q.html.includes("cid:"))
})

test("DE3. Send: one e-mail to the confirmed addresses, the PDF made from the signed print link attached, logged as sent", async () => {
  const db = docDb()
  const mail = fakeMail()
  const { d, urls } = deps(mail)
  const r = await sendDocEmail(db, "quotation", 3, { to: "Buyer@acme.com, someone@else.com", userId: 7 }, d)
  assert.equal(r.status, "sent")
  assert.equal(mail.sent.length, 1)
  const m = mail.sent[0]
  assert.deepEqual(m.to, ["buyer@acme.com", "someone@else.com"])
  assert.deepEqual(m.bcc, ["copy@misrmotors.com"])
  const files = (m.attachments || []).filter((a) => !a.cid)
  assert.equal(files.length, 1)
  assert.equal(files[0].filename, "quotation-Q-2026-003.pdf")
  assert.equal(files[0].contentType, "application/pdf")
  assert.equal(files[0].content.toString(), "%PDF-1.7 doc")
  assert.equal(urls.length, 1)
  const token = urls[0].replace("https://erp.example.com/api/doc-link/", "")
  assert.deepEqual(verifyDocLink(token, SECRET, NOW), { ok: true, kind: "quotation", id: 3 })
  const log = db.tables.document_email_log
  assert.equal(log.length, 1)
  assert.equal(log[0].status, "sent")
  assert.equal(log[0].sent_to, "buyer@acme.com, someone@else.com")
  assert.equal(log[0].created_by, 7)
  // a second Send is attempt 2; the window lists both, newest first
  assert.equal((await sendDocEmail(db, "quotation", 3, { to: ["info@acme.com"] }, d)).status, "sent")
  assert.equal(db.tables.document_email_log[1].attempt, 2)
  const view = (await docEmailView(db, "quotation", 3, { env: ENV }))!
  assert.equal(view.history.length, 2)
  assert.equal(view.history.every((h) => h.status === "sent"), true)
  assert.equal(view.configured, true)
  assert.equal(view.dbReady, true)
})

test("DE4. nothing sent: no address, not set up, PDF or SMTP failure (password hidden), document missing", async () => {
  const db = docDb()
  const mail = fakeMail()
  assert.equal((await sendDocEmail(db, "sales-order", 9, { to: "  not-an-email " }, deps(mail).d)).status, "no_email")
  assert.equal((await sendDocEmail(db, "sales-order", 9, { to: "a@b.com" }, deps(mail, { env: {} }).d)).status, "not_configured")
  const noPdf = await sendDocEmail(db, "sales-order", 9, { to: "a@b.com" }, deps(mail, { toPdf: async () => { throw new Error("chrome down") } }).d)
  assert.equal(noPdf.status, "failed")
  assert.match((noPdf as any).error, /PDF could not be made: chrome down/)
  const smtp = await sendDocEmail(db, "sales-order", 9, { to: "a@b.com" }, deps(fakeMail(true)).d)
  assert.equal(smtp.status, "failed")
  assert.ok(!(smtp as any).error.includes("abcdefgh"), "password never stored")
  assert.equal(mail.sent.length, 0)
  assert.deepEqual(db.tables.document_email_log.map((r) => r.status), ["no_email", "not_configured", "failed", "failed"])
  assert.equal((await sendDocEmail(db, "sales-order", 404, { to: "a@b.com" }, deps(mail).d)).status, "not_found")
})

test("DE5. without the log table: nothing is sent; the window says 'database update needed'", async () => {
  const db = docDb()
  const from = db.from.bind(db)
  ;(db as any).from = (table: string) =>
    table === "document_email_log" ? failing({ code: "42P01", message: 'relation "public.document_email_log" does not exist' }) : from(table)
  const mail = fakeMail()
  assert.equal((await sendDocEmail(db, "quotation", 3, { to: "a@b.com" }, deps(mail).d)).status, "db_update_needed")
  assert.equal((await docEmailView(db, "quotation", 3, { env: ENV }))!.dbReady, false)
  assert.equal(mail.sent.length, 0)
})

test("DE6. the route: sales and accountant may use it; GET shows the window, POST sends and answers in both languages", async () => {
  const rule = ruleFor("/api/document-email")!
  for (const role of ["sales-rep", "accountant", "ceo", "admin"]) assert.equal(allows(rule, "POST", [role] as any), true, role)
  for (const role of ["po-rep", "warehouse-rep"]) assert.equal(allows(rule, "POST", [role] as any), false, role)
  const db = docDb()
  useDb(db)
  const mail = fakeMail()
  const { d } = deps(mail)
  Object.assign(docEmailDefaults, d)
  try {
    const view = await route.GET(rq("GET", "/api/document-email?kind=sales-order&id=9"))
    assert.equal(view.status, 200)
    assert.deepEqual((await view.json()).suggested, ["buyer@acme.com", "second@acme.com", "info@acme.com"])
    assert.equal((await route.GET(rq("GET", "/api/document-email?kind=invoice&id=9"))).status, 400)
    assert.equal((await route.GET(rq("GET", "/api/document-email?kind=quotation&id=77"))).status, 404)
    const sent = await route.POST(rq("POST", "/api/document-email", { kind: "sales-order", id: 9, to: "buyer@acme.com" }))
    assert.equal(sent.status, 200)
    const body = await sent.json()
    assert.equal(body.status, "sent")
    assert.equal(body.email.history.length, 1)
    assert.equal(mail.sent[0].subject, "أمر بيع رقم SO-9 — مصر للمحركات")
    const empty = await route.POST(rq("POST", "/api/document-email", { kind: "sales-order", id: 9, to: "" }))
    assert.equal(empty.status, 409)
    const e = await empty.json()
    assert.equal(e.code, "no_email")
    assert.ok(e.errorAr && e.error)
  } finally {
    for (const k of Object.keys(docEmailDefaults)) delete (docEmailDefaults as any)[k]
  }
})

test("DE7. a saved quotation prints by id (the PDF's source) with its own number, date and lines; quotation links allowed", async () => {
  assert.ok(DOC_LINK_KINDS.includes("quotation" as any))
  const db = docDb()
  useDb(db)
  const res = await quotationPrint.GET(rq("GET", "/api/quotations/generate?id=3"))
  assert.equal(res.status, 200)
  const html = await res.text()
  assert.match(html, /Q-2026-003/)
  assert.match(html, /Pump 5HP/)
  assert.equal((await quotationPrint.GET(rq("GET", "/api/quotations/generate?id=99"))).status, 404)
  // the public signed link (what the PDF maker opens) shows that quotation without a login
  const saved = process.env.DOC_LINK_SECRET
  process.env.DOC_LINK_SECRET = SECRET
  try {
    const t = signDocLink("quotation", 3, SECRET)
    const open = await docLinkRoute.GET(rq("GET", `/api/doc-link/${t}`, undefined, ""), { params: Promise.resolve({ token: t }) })
    assert.equal(open.status, 200)
    assert.match(await open.text(), /Q-2026-003/)
  } finally {
    if (saved === undefined) delete process.env.DOC_LINK_SECRET
    else process.env.DOC_LINK_SECRET = saved
  }
})

test("DE8. the customer card's purchasing contact: saved and read; without the column the rest saves with a warning", async () => {
  const cdb = new FakeDb({ customers: [{ customer_id: 5, customer_name: "Acme", email: "a@acme.com", created_at: "2026-01-01" }] })
  cdb.jitter = false
  useDb(cdb)
  const put = await customersRoute.PUT(rq("PUT", "/api/customers", { id: "5", salespersonEmail: " buyer@acme.com " }, "accountant"))
  assert.equal(put.status, 200)
  assert.equal(cdb.tables.customers[0].salesperson_email, "buyer@acme.com")
  assert.equal((await (await customersRoute.GET()).json())[0].salespersonEmail, "buyer@acme.com")
  const cfrom = cdb.from.bind(cdb)
  ;(cdb as any).from = (table: string) => {
    const q: any = cfrom(table)
    const update = q.update.bind(q)
    q.update = (patch: any) =>
      table === "customers" && "salesperson_email" in patch
        ? failing({ code: "PGRST204", message: "Could not find the 'salesperson_email' column of 'customers' in the schema cache" })
        : update(patch)
    return q
  }
  const noColumn = await customersRoute.PUT(rq("PUT", "/api/customers", { id: "5", phone: "0100", salespersonEmail: "x@acme.com" }, "accountant"))
  assert.equal(noColumn.status, 200)
  assert.deepEqual((await noColumn.json()).taxWarnings, ["salesperson_email: not saved, database update needed"])
  assert.equal(cdb.tables.customers[0].phone, "0100")
})

test("DE9. the database update is additive only; nothing sends on its own (no Send outside the route)", () => {
  const sql = readFileSync(join(REPO, "scripts/sql/2026-11-27-document-email.sql"), "utf8")
  assert.match(sql, /alter table public\.customers add column if not exists salesperson_email text/i)
  assert.match(sql, /create table if not exists public\.document_email_log/i)
  assert.ok(!/\b(drop|delete|truncate)\b/i.test(sql.replace(/--.*$/gm, "")))
  const dialog = readFileSync(join(REPO, "components/email/send-to-customer-dialog.tsx"), "utf8")
  assert.match(dialog, /method: "POST"/)
  assert.ok(!dialog.split("const send = ")[0].includes(`method: "POST"`), "the window only reads until Send is pressed")
})
