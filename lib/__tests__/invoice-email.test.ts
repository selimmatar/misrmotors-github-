// The e-invoice e-mail to the customer (owner request 2026-11-24; manual only, owner correction 2026-11-26): nothing is
// e-mailed when the invoice becomes valid; a person's "Send" / "Send again" e-mails the portal's PDF and signed view /
// print links and logs it; no customer e-mail / not set up / no log table; the signed links; the public path; the
// Gmail SMTP conversation (fake socket). Fake SMTP and fake portal only.
import { useDb } from "./route-harness"
import test from "node:test"
import assert from "node:assert/strict"
import { EventEmitter } from "node:events"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { FakeDb } from "./fake-db"
import { etaSendDefaults, followUpQuietly, type SendDeps } from "../eta/send"
import { resetPrintoutGuard } from "../eta/after-send"
import type { EtaPortal } from "../eta/portal"
import {
  MAX_ATTACHMENT_BYTES, buildInvoiceEmail, emailConfig, emailList, invoiceEmailDefaults, invoiceEmailView,
  sendInvoiceEmail, type EmailDeps,
} from "../eta/invoice-email"
import { DOC_LINK_DAYS, signDocLink, verifyDocLink } from "../doc-links"
import { buildMime, dotStuff, encodeHeaderWord, gmailTransport, type MailMessage, type MailTransport } from "../email/smtp"
import { PUBLIC_PATHS, PUBLIC_PREFIXES, allows, isPublicPath, ruleFor } from "../auth/permissions"
import { decide } from "../auth/decide"
import { runDailySync } from "../eta/daily-sync"
import * as emailRoute from "../../app/api/eta/invoice-email/route"
import * as docLinkRoute from "../../app/api/doc-link/[token]/route"
import * as customersRoute from "../../app/api/customers/route"
import { fitAttachments, jpegInfo } from "../eta/signed-permits"

const REPO = process.env.REPO_ROOT || process.cwd()
const SECRET = "s".repeat(40)
const PASS = "abcd efgh ijkl mnop"
const ENV = {
  EMAIL_SMTP_USER: "misrmotors.invoices@gmail.com",
  EMAIL_SMTP_PASS: PASS,
  EMAIL_BCC: "copy@misrmotors.com",
  DOC_LINK_SECRET: SECRET,
  APP_BASE_URL: "https://erp.example.com",
}
const NOW = new Date("2026-11-24T10:00:00Z")
const PDF = new TextEncoder().encode("%PDF-1.7 portal").buffer

function emailDb(opts: { email?: string | null; documentType?: "I" | "C"; status?: string } = {}) {
  const db = new FakeDb({
    users: [{ user_id: 7 }],
    accounts_receivable: [{ invoice_id: 1, invoice_number: "INV-1001", so_id: 1, amount: 342, customer_id: 5, created_at: "2026-11-20T08:00:00Z" }],
    customers: [{ customer_id: 5, customer_name: "Acme Trading", email: opts.email === undefined ? "buyer@acme.com, Accounts@Acme.com" : opts.email }],
    invoice_delivery_permits: [{ invoice_id: 1, permit_id: 1 }, { invoice_id: 1, permit_id: 2 }],
    delivery_permits: [{ permit_id: 1, permit_no: "DP-1", sales_order_id: 1 }, { permit_id: 2, permit_no: "DP-2", sales_order_id: 1 }],
    sales_orders: [{ so_id: 1, so_number: "SO-1", customer_id: 5, status: "approved" }, { so_id: 2, so_number: "SO-2", customer_id: 5, status: "approved" }],
    sales_order_items: [], product_returns: [], return_items: [],
    eta_documents: [{
      doc_id: 1, invoice_id: 1, document_type: opts.documentType || "I", environment: "real", version: 1, status: opts.status || "submitted",
      submission_uuid: "SUB1", eta_uuid: "UUID-1", eta_long_id: null, checked_at: null, submitted_at: "2026-11-24T09:00:00Z",
      document: JSON.stringify({ internalID: "INV-1001", dateTimeIssued: "2026-11-20T08:00:00Z", totalAmount: 342, receiver: { name: "Acme Trading" } }),
    }],
    invoice_email_log: [],
    company_settings: [{ setting_key: "eta_environment", setting_value: "real" }],
  })
  db.jitter = false
  return db
}

function portalFake(status = "Valid") {
  const calls = { printout: [] as string[], getSubmission: [] as string[] }
  const no = async () => { throw new Error("no") }
  const portal: EtaPortal = {
    submit: no, getDetails: async () => ({}), cancel: no, searchReceived: no, searchSentWindow: no, searchSent: async () => ({ result: [] }), documentType: no, myCodes: no,
    async getSubmission(uuid) { calls.getSubmission.push(uuid); return { documentSummary: [{ uuid: "UUID-1", longId: "LONG-1", status }] } },
    async printout(uuid) { calls.printout.push(uuid); return PDF },
  }
  const deps: SendDeps = { now: () => NOW, portalFor: () => portal, credentialsSet: () => true, sleep: async () => {} }
  return { portal, calls, deps }
}

/** the files attached to an e-mail (not the logo shown inside it) */
const fileParts = (m: MailMessage) => (m.attachments || []).filter((a) => !a.cid)

function fakeTransport(fail?: (n: number) => string | null) {
  const sent: MailMessage[] = []
  let n = 0
  const transport: MailTransport = {
    async send(m) {
      n++
      const why = fail?.(n)
      if (why) throw new Error(why)
      sent.push(m)
      return { messageId: `<m${n}@test>` }
    },
  }
  return { sent, transport }
}

async function withDefaults<T>(email: EmailDeps, send: SendDeps, fn: () => Promise<T>): Promise<T> {
  Object.assign(invoiceEmailDefaults, email)
  Object.assign(etaSendDefaults, send)
  try {
    return await fn()
  } finally {
    for (const k of Object.keys(invoiceEmailDefaults)) delete (invoiceEmailDefaults as any)[k]
    for (const k of Object.keys(etaSendDefaults)) delete (etaSendDefaults as any)[k]
  }
}

function rq(method: string, path: string, body?: unknown, headers: Record<string, string> = {}): any {
  const url = `http://test.local${path}`
  const r = new Request(url, { method, headers: { "content-type": "application/json", "x-mm-roles": "accountant", "x-mm-user-id": "7", ...headers }, body: body === undefined ? undefined : JSON.stringify(body) })
  return Object.assign(r, { nextUrl: new URL(url) })
}

/** "Send" / "Send again" in the invoice's e-invoice window, as the accountant (the only way an e-mail goes out). */
async function pressSend(db: FakeDb, mail: { transport: MailTransport }, portal: EtaPortal = portalFake().portal, now = NOW, extra: EmailDeps = {}) {
  useDb(db)
  resetPrintoutGuard()
  return withDefaults({ env: ENV, transport: mail.transport, now: () => now, ...extra }, { portalFor: () => portal, credentialsSet: () => true }, () =>
    emailRoute.POST(rq("POST", "/api/eta/invoice-email", { invoiceId: 1 })),
  )
}

test("M1. valid on the portal -> NO e-mail by itself; the accountant's Send -> one e-mail: portal PDF, links to the invoice, the sales order and each delivery permit", async () => {
  const db = emailDb()
  const fake = portalFake()
  const mail = fakeTransport()
  resetPrintoutGuard()
  await withDefaults({ env: ENV, transport: mail.transport }, {}, () => followUpQuietly(db, fake.deps))
  assert.equal(db.tables.eta_documents[0].status, "valid")
  assert.equal(mail.sent.length, 0, "never sent automatically when the portal says valid")
  assert.equal(db.tables.invoice_email_log.length, 0)
  assert.deepEqual(await invoiceEmailView(db, 1, { env: ENV, now: () => NOW }), { configured: true, dbReady: true, last: null })
  // the person presses Send
  const res = await pressSend(db, mail, fake.portal)
  assert.equal(res.status, 200)
  assert.equal(mail.sent.length, 1)
  const m = mail.sent[0]
  assert.deepEqual(m.to, ["buyer@acme.com", "accounts@acme.com"])
  assert.deepEqual(m.bcc, ["copy@misrmotors.com"])
  assert.deepEqual(m.from, { name: "Misr Motors | مصر للمحركات", address: "misrmotors.invoices@gmail.com" })
  assert.equal(m.subject, "فاتورة رقم INV-1001 — مصر للمحركات")
  assert.equal(fileParts(m).length, 1)
  assert.equal(fileParts(m)[0].contentType, "application/pdf")
  assert.equal(fileParts(m)[0].content.toString(), "%PDF-1.7 portal")
  for (const s of ["Acme Trading", "INV-1001", "20/11/2026", "342.00", "UUID-1", "incl. VAT", "https://invoicing.eta.gov.eg/documents/UUID-1/share/LONG-1"]) assert.ok(m.text.includes(s), s)
  // the links, each opening only its document; no unsigned delivery permit (owner request 2026-11-25)
  const links = [...m.text.matchAll(/https:\/\/erp\.example\.com\/api\/doc-link\/(\S+)/g)].map((x) => x[1])
  const opened = links.map((t) => verifyDocLink(t, SECRET, NOW)).map((c) => (c.ok ? `${c.kind}:${c.id}` : c.reason))
  assert.deepEqual(opened, ["invoice:1", "sales-order:1"])
  assert.ok(!m.text.includes("doc-link/v1.delivery-permit") && !m.html.includes("doc-link/v1.delivery-permit"))
  assert.ok(m.html.includes('dir="rtl"') && m.html.includes("/api/doc-link/v1.invoice.1."))
  // the log row
  const log = db.tables.invoice_email_log
  assert.equal(log.length, 1)
  assert.equal(log[0].status, "sent")
  assert.equal(log[0].trigger, "manual")
  assert.equal(log[0].attempt, 1)
  assert.equal(log[0].eta_uuid, "UUID-1")
  assert.equal(log[0].sent_to, "buyer@acme.com, accounts@acme.com")
  assert.equal(log[0].claim_key, null)
  assert.equal(log[0].created_by, 7)
  assert.equal(log[0].sent_at, NOW.toISOString())
  const view = await invoiceEmailView(db, 1, { env: ENV, now: () => NOW })
  assert.deepEqual(view, { configured: true, dbReady: true, last: { status: "sent", to: "buyer@acme.com, accounts@acme.com", error: null, at: NOW.toISOString(), trigger: "manual" } })
})

test("M2. nothing sends by itself: follow-up, the daily job and the old automatic start setting never e-mail", async () => {
  const db = emailDb({ status: "valid" })
  db.tables.eta_documents[0].validated_at = "2026-11-24T09:30:00Z"
  db.tables.eta_documents[0].eta_long_id = "LONG-1"
  db.tables.company_settings.push({ setting_key: "invoice_email_auto_from", setting_value: "2026-11-01T00:00:00Z" })
  const fake = portalFake()
  const mail = fakeTransport()
  resetPrintoutGuard()
  await withDefaults({ env: ENV, transport: mail.transport }, {}, () => followUpQuietly(db, fake.deps))
  const daily = await withDefaults({ env: ENV, transport: mail.transport }, {}, () => runDailySync(db, { credentialsSet: () => false, send: fake.deps }))
  assert.ok(!("emailed" in daily))
  assert.equal(mail.sent.length, 0)
  assert.equal(db.tables.invoice_email_log.length, 0)
  // the automatic sender is gone from the code, and the send itself refuses anything but a person's Send
  const src = readFileSync(join(REPO, "lib/eta/invoice-email.ts"), "utf8")
  for (const gone of ["emailValidInvoices", "autoAttemptDue", "invoice_email_auto_from", "claim_key: opts.trigger"]) assert.ok(!src.includes(gone), gone)
  for (const f of ["lib/eta/send.ts", "lib/eta/daily-sync.ts", "app/api/eta-sync/route.ts"]) assert.ok(!/invoice-email|sendInvoiceEmail|emailValidInvoices/.test(readFileSync(join(REPO, f), "utf8")), f)
  await assert.rejects(sendInvoiceEmail(db, 1, { trigger: "auto" as any }, { env: ENV, transport: mail.transport }), /by hand only/)
  assert.equal(mail.sent.length, 0)
})

test("M3. credit notes are never e-mailed: Send on a credit note only answers 'no valid invoice'", async () => {
  const mail = fakeTransport()
  const credit = emailDb({ documentType: "C", status: "valid" })
  credit.tables.eta_documents[0].validated_at = "2026-11-24T09:30:00Z"
  const res = await pressSend(credit, mail)
  assert.equal(res.status, 409)
  assert.equal((await res.json()).code, "not_valid")
  assert.equal(mail.sent.length, 0)
  assert.equal(credit.tables.invoice_email_log.length, 0)
})

test("M4. no customer e-mail -> status 'no_email' on the invoice, nothing sent; add it and Send again", async () => {
  const db = emailDb({ email: null, status: "valid" })
  db.tables.eta_documents[0].validated_at = "2026-11-24T09:30:00Z"
  const mail = fakeTransport()
  const res0 = await pressSend(db, mail)
  assert.equal(res0.status, 409)
  assert.equal((await res0.json()).code, "no_email")
  assert.equal(mail.sent.length, 0)
  assert.equal(db.tables.invoice_email_log[0].status, "no_email")
  assert.equal((await invoiceEmailView(db, 1, { env: ENV })).last!.status, "no_email")
  // a broken address is not an address
  assert.deepEqual(emailList("x, a@b.co; A@B.co\nbad@ c@d"), ["a@b.co"])
  // the accountant adds it and presses Send again
  db.tables.customers[0].email = "new@acme.com"
  const res = await pressSend(db, mail)
  assert.equal(res.status, 200)
  assert.deepEqual(mail.sent.map((m) => m.to), [["new@acme.com"]])
})

test("M5. e-mail not set up (env missing) -> nothing sent; the invoice says 'not set up'; the password is never shown", async () => {
  const db = emailDb({ status: "valid" })
  db.tables.eta_documents[0].validated_at = "2026-11-24T09:30:00Z"
  const mail = fakeTransport()
  for (const missing of ["EMAIL_SMTP_USER", "EMAIL_SMTP_PASS", "DOC_LINK_SECRET"] as const) {
    const cfg = emailConfig({ ...ENV, [missing]: "" })
    assert.ok(!cfg.ok && cfg.missing.includes(missing), missing)
  }
  assert.ok(!emailConfig({ ...ENV, DOC_LINK_SECRET: "short" }).ok, "a short link secret counts as not set")
  assert.ok(!emailConfig({ ...ENV, APP_BASE_URL: "" }).ok)
  assert.ok(emailConfig({ ...ENV, APP_BASE_URL: "", VERCEL_PROJECT_PRODUCTION_URL: "erp.misrmotors.com" }).ok)
  assert.equal((await invoiceEmailView(db, 1, { env: {} })).configured, false)
  // the window names the setting that is wrong (name only, never a value)
  const short = await invoiceEmailView(db, 1, { env: { ...ENV, DOC_LINK_SECRET: "short" } })
  assert.deepEqual(short.missing, ["DOC_LINK_SECRET"])
  assert.ok(!JSON.stringify(short).includes(PASS), "no value leaks into the view")
  assert.equal((await invoiceEmailView(db, 1, { env: ENV })).missing, undefined)
  // the button: 409 "not set up", logged by name only
  useDb(db)
  const res = await withDefaults({ env: { EMAIL_SMTP_PASS: PASS }, transport: mail.transport }, {}, () => emailRoute.POST(rq("POST", "/api/eta/invoice-email", { invoiceId: 1 })))
  assert.equal(res.status, 409)
  const body = await res.json()
  assert.equal(body.code, "not_configured")
  assert.ok(!JSON.stringify(body).includes(PASS) && !JSON.stringify(db.tables).includes(PASS))
  assert.equal(db.tables.invoice_email_log[0].status, "not_configured")
  assert.match(db.tables.invoice_email_log[0].error, /EMAIL_SMTP_USER/)
  assert.equal(mail.sent.length, 0)
  // an SMTP error that echoes the password is masked
  const leaky = fakeTransport(() => `535 bad credentials for ${PASS.replace(/\s+/g, "")}`)
  resetPrintoutGuard()
  const r = await sendInvoiceEmail(db, 1, { trigger: "manual" }, { ...portalFake().deps, env: ENV, transport: leaky.transport })
  assert.equal(r.status, "failed")
  assert.ok(!JSON.stringify(r).includes(PASS.replace(/\s+/g, "")) && !JSON.stringify(db.tables).includes(PASS.replace(/\s+/g, "")))
})

test("M6. Send, then Send again -> a second e-mail, both logged as manual; the button reads Send then Send again; accountant / CEO / admin only", async () => {
  const db = emailDb({ status: "valid" })
  db.tables.eta_documents[0].validated_at = "2026-11-24T09:30:00Z"
  const fake = portalFake()
  const mail = fakeTransport()
  const label = async () => ((await invoiceEmailView(db, 1, { env: ENV })).last ? "eta.email-send-again" : "eta.email-send")
  assert.equal(await label(), "eta.email-send")
  assert.equal((await pressSend(db, mail, fake.portal)).status, 200)
  assert.equal(mail.sent.length, 1)
  assert.equal(await label(), "eta.email-send-again")
  const res = await pressSend(db, mail, fake.portal)
  assert.equal(res.status, 200)
  const body = await res.json()
  assert.equal(body.status, "sent")
  assert.equal(body.email.last.trigger, "manual")
  assert.equal(mail.sent.length, 2)
  assert.deepEqual(db.tables.invoice_email_log.map((r) => [r.trigger, r.attempt, r.claim_key, r.created_by]), [["manual", 1, null, 7], ["manual", 2, null, 7]])
  assert.equal((await emailRoute.POST(rq("POST", "/api/eta/invoice-email", {}))).status, 400)
  const view = await withDefaults({ env: ENV }, {}, () => emailRoute.GET(rq("GET", "/api/eta/invoice-email?invoiceId=1")))
  assert.equal((await view.json()).last.status, "sent")
  // the button is in the invoice's ⋯ menu (owner request 2026-11-25): "Send by e-mail", then "Send by e-mail again",
  // and the row shows "Sent to customer" once an e-mail went out
  const ar = readFileSync(join(REPO, "components/modules/accounts-receivable-module.tsx"), "utf8")
  assert.ok(ar.includes('etaBadges.emailed.has(String(invoice.id)) ? t("eta.email-send-again-menu") : t("eta.email-send")'))
  assert.ok(ar.includes("<EmailedBadge />"))
  assert.ok(!readFileSync(join(REPO, "components/accounting/eta-preview-dialog.tsx"), "utf8").includes("/api/eta/invoice-email"))
  const rule = ruleFor("/api/eta/invoice-email")!
  for (const role of ["accountant", "ceo", "admin"]) assert.equal(allows(rule, "POST", [role] as any), true, role)
  for (const role of ["sales-rep", "po-rep", "warehouse-rep"]) assert.equal(allows(rule, "POST", [role] as any), false, role)
})

test("M7. an SMTP failure is logged with the reason and never retried by itself; Send again tries again", async () => {
  const db = emailDb({ status: "valid" })
  db.tables.eta_documents[0].validated_at = "2026-11-24T09:30:00Z"
  let refuse = true
  const mail = fakeTransport(() => (refuse ? "421 try later" : null))
  const res = await pressSend(db, mail)
  assert.equal(res.status, 502)
  const view = await invoiceEmailView(db, 1, { env: ENV, now: () => NOW })
  assert.equal(view.last!.status, "failed")
  assert.match(view.last!.error!, /421 try later/)
  // time passes, the follow-up and the daily job run: nothing is retried by itself
  const later = { ...portalFake().deps, now: () => new Date(NOW.getTime() + 86_400_000) }
  await withDefaults({ env: ENV, transport: mail.transport }, {}, () => followUpQuietly(db, later))
  await withDefaults({ env: ENV, transport: mail.transport }, {}, () => runDailySync(db, { credentialsSet: () => false, send: later }))
  assert.equal(db.tables.invoice_email_log.length, 1)
  refuse = false
  assert.equal((await pressSend(db, mail)).status, 200)
  assert.deepEqual(db.tables.invoice_email_log.map((r) => [r.attempt, r.status]), [[1, "failed"], [2, "sent"]])
})

test("M8. without the invoice_email_log table: nothing is sent; the button says 'database update needed'", async () => {
  const db = emailDb({ status: "valid" })
  db.tables.eta_documents[0].validated_at = "2026-11-24T09:30:00Z"
  const from = db.from.bind(db)
  ;(db as any).from = (table: string) => {
    if (table !== "invoice_email_log") return from(table)
    const missing = { data: null, error: { code: "42P01", message: 'relation "public.invoice_email_log" does not exist' } }
    const q: any = new Proxy({}, { get: (_t, k) => (k === "then" ? (ok: any, no: any) => Promise.resolve(missing).then(ok, no) : () => q) })
    return q
  }
  const mail = fakeTransport()
  assert.deepEqual(await invoiceEmailView(db, 1, { env: ENV }), { configured: true, dbReady: false, last: null })
  useDb(db)
  const res = await withDefaults({ env: ENV, transport: mail.transport }, {}, () => emailRoute.POST(rq("POST", "/api/eta/invoice-email", { invoiceId: 1 })))
  assert.equal(res.status, 409)
  assert.equal((await res.json()).code, "db_update_needed")
  assert.equal(mail.sent.length, 0)
})

test("M9. signed links: only its own document, tampering and expiry refused; the public route renders that print only", async () => {
  const token = signDocLink("sales-order", 1, SECRET, NOW)
  assert.deepEqual(verifyDocLink(token, SECRET, NOW), { ok: true, kind: "sales-order", id: 1 })
  const [v, kind, id, exp, sig] = token.split(".")
  assert.equal(Number(exp), Math.floor(NOW.getTime() / 1000) + DOC_LINK_DAYS * 86_400)
  const bad = (t: string) => verifyDocLink(t, SECRET, NOW)
  assert.deepEqual(bad([v, kind, "2", exp, sig].join(".")), { ok: false, reason: "invalid" }, "another id")
  assert.deepEqual(bad([v, "invoice", id, exp, sig].join(".")), { ok: false, reason: "invalid" }, "another kind")
  assert.deepEqual(bad([v, kind, id, String(Number(exp) + 86_400), sig].join(".")), { ok: false, reason: "invalid" }, "a later expiry")
  assert.deepEqual(bad([v, kind, id, exp, sig.slice(0, -1) + (sig.endsWith("A") ? "B" : "A")].join(".")), { ok: false, reason: "invalid" }, "another signature")
  assert.deepEqual(verifyDocLink(token, "t".repeat(40), NOW), { ok: false, reason: "invalid" }, "another secret")
  assert.deepEqual(bad("v1.sales-order.1"), { ok: false, reason: "invalid" })
  assert.deepEqual(verifyDocLink(token, SECRET, new Date(NOW.getTime() + (DOC_LINK_DAYS + 1) * 86_400_000)), { ok: false, reason: "expired" })
  assert.deepEqual(verifyDocLink(token, null, NOW), { ok: false, reason: "not_configured" })

  const db = emailDb()
  useDb(db)
  const saved = process.env.DOC_LINK_SECRET
  process.env.DOC_LINK_SECRET = SECRET
  try {
    const get = (t: string) => docLinkRoute.GET(rq("GET", `/api/doc-link/${t}`, undefined, { "x-mm-roles": "" }), { params: Promise.resolve({ token: t }) })
    const fresh = signDocLink("sales-order", 1, SECRET)
    const ok = await get(fresh)
    assert.equal(ok.status, 200)
    const html = await ok.text()
    assert.match(html, /SO-1/)
    assert.doesNotMatch(html, /SO-2/)
    assert.equal(ok.headers.get("cache-control"), "private, no-store")
    const [fv, fk, , fe, fs] = fresh.split(".")
    assert.equal((await get([fv, fk, "2", fe, fs].join("."))).status, 404, "the link of SO 1 does not open SO 2")
    assert.equal((await get(signDocLink("sales-order", 1, SECRET, new Date(Date.now() - (DOC_LINK_DAYS + 1) * 86_400_000)))).status, 410)
    assert.equal((await get(signDocLink("sales-order", 999, SECRET))).status, 404, "a document that is gone")
    delete process.env.DOC_LINK_SECRET
    assert.equal((await get(fresh)).status, 503)
  } finally {
    if (saved === undefined) delete process.env.DOC_LINK_SECRET
    else process.env.DOC_LINK_SECRET = saved
  }
})

test("M10. public paths: /api/doc-link/<token> is open without a login (deliberately); nothing else changed", () => {
  // owner request 2026-11-24: the customer opens the e-mail's links without an account; the route checks the signature
  assert.deepEqual(PUBLIC_PREFIXES, ["/api/worker-upload/", "/api/doc-link/"])
  assert.deepEqual(PUBLIC_PATHS, ["/api/auth/login", "/api/auth/logout", "/api/auth/forgot", "/api/auth/me", "/api/eta-signer/next", "/api/eta-signer/signed", "/api/eta-signer/ping", "/api/eta-sync"])
  assert.equal(isPublicPath("/api/doc-link/v1.invoice.1.2.x"), true)
  assert.deepEqual(decide({ mode: "on", path: "/api/doc-link/v1.invoice.1.2.x", method: "GET", identity: null, idle: false }), { kind: "allow" })
  for (const p of ["/api/doc-link", "/api/doc-links/x", "/api/eta/invoice-email", "/api/invoices/ar/1/pdf", "/api/sales-orders/print"]) {
    const d = decide({ mode: "on", path: p, method: "GET", identity: null, idle: false })
    assert.equal(d.kind === "refuse" && d.status, 401, p)
  }
})

test("M11. Gmail SMTP: TLS 465, AUTH PLAIN, MAIL / RCPT (to + bcc) / DATA with a dot-stuffed MIME message; refusals in plain words without the password", async () => {
  function fakeServer(refuse?: { on: string; reply: string }) {
    const written: string[] = []
    let options: any
    const connect: any = (o: any) => {
      options = o
      const s: any = new EventEmitter()
      const say = (line: string) => setImmediate(() => s.emit("data", line + "\r\n"))
      let inData = false
      let data = ""
      s.setEncoding = () => s
      s.end = () => undefined
      s.destroy = () => undefined
      s.write = (chunk: string) => {
        written.push(chunk)
        if (inData) {
          data += chunk
          if (data.endsWith("\r\n.\r\n")) { inData = false; say("250 2.0.0 OK queued") }
          return true
        }
        const cmd = chunk.trim()
        if (refuse && cmd.startsWith(refuse.on)) say(refuse.reply)
        else if (cmd.startsWith("EHLO")) { say("250-smtp.gmail.com at your service"); say("250-AUTH LOGIN PLAIN"); say("250 SMTPUTF8") }
        else if (cmd.startsWith("AUTH")) say("235 2.7.0 Accepted")
        else if (cmd.startsWith("MAIL") || cmd.startsWith("RCPT")) say("250 2.1.0 OK")
        else if (cmd === "DATA") { inData = true; say("354 Go ahead") }
        else if (cmd === "QUIT") say("221 bye")
        return true
      }
      say("220 smtp.gmail.com ESMTP ready")
      return s
    }
    return { connect, written, opts: () => options }
  }
  const message: MailMessage = {
    from: { name: "Misr Motors | مصر للمحركات", address: "misrmotors.invoices@gmail.com" },
    to: ["buyer@acme.com"], bcc: ["copy@misrmotors.com"],
    subject: "فاتورة رقم INV-1001 — مصر للمحركات", text: "line\n.starts with a dot", html: "<p>x</p>",
    attachments: [{ filename: "invoice INV/1001.pdf", content: Buffer.from("%PDF"), contentType: "application/pdf" }],
  }
  const server = fakeServer()
  const pass = "abcdefghijklmnop"
  await gmailTransport({ user: "misrmotors.invoices@gmail.com", pass }, { connect: server.connect }).send(message)
  assert.deepEqual([server.opts().host, server.opts().port], ["smtp.gmail.com", 465])
  const cmds = server.written.map((w) => w.trim())
  assert.equal(cmds[1], `AUTH PLAIN ${Buffer.from(`\u0000misrmotors.invoices@gmail.com\u0000${pass}`).toString("base64")}`)
  assert.deepEqual(cmds.filter((c) => /^(MAIL|RCPT)/.test(c)), ["MAIL FROM:<misrmotors.invoices@gmail.com>", "RCPT TO:<buyer@acme.com>", "RCPT TO:<copy@misrmotors.com>"])
  const mime = server.written.find((w) => w.includes("MIME-Version"))!
  assert.ok(!/^Bcc:/im.test(mime), "no Bcc header")
  assert.match(mime, /filename="invoice_INV_1001.pdf"/)
  const subject = /Subject: ([\s\S]*?)\r\nDate:/.exec(mime)![1]
  const decoded = Buffer.concat([...subject.matchAll(/=\?UTF-8\?B\?([^?]+)\?=/g)].map((m) => Buffer.from(m[1], "base64"))).toString("utf8")
  assert.equal(decoded, message.subject)
  assert.equal(encodeHeaderWord("plain"), "plain")
  assert.equal(dotStuff("a\r\n.b\r\n..c"), "a\r\n..b\r\n...c")
  assert.throws(() => buildMime({ ...message, to: ["x@y.com\r\nBcc: evil@z.com"] }), /Invalid e-mail address/)

  const refused = fakeServer({ on: "AUTH", reply: `535 5.7.8 Username and Password not accepted ${pass}` })
  await assert.rejects(
    () => gmailTransport({ user: "misrmotors.invoices@gmail.com", pass }, { connect: refused.connect }).send(message),
    (e: any) => /SMTP login refused \(535\)/.test(e.message) && !e.message.includes(pass),
  )
})

test("M12. the database script, the screen and the texts", () => {
  const raw = readFileSync(join(REPO, "scripts/sql/2026-11-25-invoice-email.sql"), "utf8")
  assert.match(raw, /WRITTEN, NOT APPLIED/)
  const sql = raw.split("\n").map((l) => l.replace(/--.*$/, "")).join("\n").toLowerCase().replace(/\s+/g, " ")
  for (const s of sql.split(";").map((x) => x.trim()).filter(Boolean)) {
    assert.ok(/^(create table if not exists|create (unique )?index if not exists|alter table public\.invoice_email_log enable row level security|alter table public\.customers add column if not exists accountant_email text$|comment on)/.test(s), `not additive: ${s.slice(0, 60)}`)
  }
  assert.ok(!/create policy/.test(sql))
  assert.match(sql, /unique index if not exists invoice_email_log_claim_key_key on public\.invoice_email_log \(claim_key\)/)
  for (const c of ["invoice_id", "eta_uuid", "sent_to", "status", "error", "sent_at", "attempt", "trigger"]) assert.ok(sql.includes(` ${c} `), c)
  for (const s of ["'sent'", "'failed'", "'no_email'", "'not_configured'", "'auto'", "'manual'"]) assert.ok(sql.includes(s), s)

  // the window shows the e-mail line; sending is in the row's ⋯ menu (eta-ar-bits.tsx, owner request 2026-11-25)
  const dialog = readFileSync(join(REPO, "components/accounting/eta-preview-dialog.tsx"), "utf8") + readFileSync(join(REPO, "components/accounting/eta-ar-bits.tsx"), "utf8")
  assert.ok(dialog.includes('"/api/eta/invoice-email"'))
  assert.match(dialog, /<EtaEmailStatus email=\{preview\.email\}/)
  const i18n = readFileSync(join(REPO, "lib/i18n-context.tsx"), "utf8")
  const arAt = i18n.indexOf("\n  ar: {")
  const keys = [...dialog.matchAll(/\bt\("(eta\.email-[a-z-]+)"\)/g)].map((m) => m[1])
  assert.ok(keys.length >= 9)
  for (const k of keys) {
    assert.ok(i18n.slice(0, arAt).includes(`"${k}":`) && i18n.slice(arAt).includes(`"${k}":`), k)
    assert.ok(i18n.indexOf(`"${k}"`) < i18n.indexOf('"eta.go-live-started"'), `${k} before eta.go-live-started (en)`)
    assert.ok(i18n.indexOf(`"${k}"`, arAt) < i18n.indexOf('"eta.go-live-started"', arAt), `${k} before eta.go-live-started (ar)`)
  }
  // the e-mail text itself
  const e = buildInvoiceEmail({ customerName: "<b>Acme</b>", invoiceNumber: "INV-1", date: "01/01/2026", total: 1000, uuid: "U", portalUrl: null, invoiceUrl: "https://x/i", salesOrders: [], permits: [] })
  assert.ok(e.html.includes("&lt;b&gt;Acme&lt;/b&gt;") && !e.html.includes("<b>Acme"))
  assert.match(e.text, /بإجمالي 1,000.00 جنيه مصري شاملًا ضريبة القيمة المضافة/)
})

// a tiny JPEG header: SOI, an APP0 segment, then SOF0 with height 16, width 32, 3 colour channels
const JPEG = (tag: number) =>
  Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x04, 0x00, 0x00, 0xff, 0xc0, 0x00, 0x11, 0x08, 0x00, 0x10, 0x00, 0x20, 0x03, 1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1, 0xff, 0xd9, tag])

/** a query whose every call answers `error` (a missing table / column) */
const failing = (error: { code: string; message: string }) => {
  const answer = { data: null, error }
  const q: any = new Proxy({}, { get: (_t, k) => (k === "then" ? (ok: any, no: any) => Promise.resolve(answer).then(ok, no) : () => q) })
  return q
}

test("M13. signed delivery-permit copies: photos -> one PDF per permit, an uploaded PDF as is, 'not uploaded' left out, too big -> linked", async () => {
  assert.deepEqual(jpegInfo(JPEG(1)), { width: 32, height: 16, components: 3 })
  assert.equal(jpegInfo(Buffer.from("%PDF-1.4")), null)
  const blob = (n: string) => `https://abc.public.blob.vercel-storage.com/delivery-permits/${n}`
  const files: Record<string, { bytes: Buffer; type: string }> = {
    [blob("1/a.jpg")]: { bytes: JPEG(1), type: "image/jpeg" },
    [blob("1/b.jpg")]: { bytes: JPEG(2), type: "image/jpeg" },
    [blob("2/scan.pdf")]: { bytes: Buffer.from("%PDF-1.7 signed DP-2"), type: "application/pdf" },
  }
  const fetched: string[] = []
  const fetchFile = async (url: string) => {
    fetched.push(url)
    if (!files[url]) throw new Error("404")
    return files[url]
  }
  const send = async (db: FakeDb) => {
    const mail = fakeTransport()
    resetPrintoutGuard()
    const r = await sendInvoiceEmail(db, 1, { trigger: "manual" }, { ...portalFake().deps, env: ENV, transport: mail.transport, fetchFile })
    assert.equal(r.status, "sent")
    return mail.sent[0]
  }

  // DP-1: two photos -> one PDF of two pages; DP-2: nothing signed uploaded (a file of another type is ignored)
  const db = emailDb({ status: "valid" })
  db.tables.delivery_permit_files = [
    { file_id: 1, permit_id: 1, file_type: "SIGNED_PERMIT", file_url: blob("1/a.jpg"), file_name: "a.jpg" },
    { file_id: 2, permit_id: 1, file_type: "SIGNED_PERMIT", file_url: blob("1/b.jpg"), file_name: "b.jpg" },
    { file_id: 3, permit_id: 2, file_type: "OTHER", file_url: blob("2/other.pdf"), file_name: "other.pdf" },
  ]
  const m1 = await send(db)
  assert.deepEqual(fileParts(m1).map((a) => a.filename), ["invoice-INV-1001.pdf", "signed-DP-1.pdf"])
  const dp1 = fileParts(m1)[1].content.toString("latin1")
  assert.ok(dp1.startsWith("%PDF-1.4") && /\/Count 2\b/.test(dp1))
  // only signed copies are mentioned: DP-1 attached, DP-2 (nothing signed uploaded) left out
  assert.ok(m1.text.includes("Signed delivery permit DP-1"))
  assert.ok(m1.text.includes("إذن التسليم DP-1 موقعًا"))
  assert.ok(!m1.text.includes("DP-2") && !m1.html.includes("DP-2"))
  assert.ok(!fetched.includes(blob("2/other.pdf")))

  // DP-2 uploaded as a PDF: attached as it is
  db.tables.delivery_permit_files.push({ file_id: 4, permit_id: 2, file_type: "SIGNED_PERMIT", file_url: blob("2/scan.pdf"), file_name: "scan.pdf" })
  const m2 = await send(db)
  assert.deepEqual(fileParts(m2).map((a) => a.filename), ["invoice-INV-1001.pdf", "signed-DP-1.pdf", "signed-DP-2.pdf"])
  assert.equal(fileParts(m2)[2].content.toString(), "%PDF-1.7 signed DP-2")

  // too big for the e-mail (over ~18 MB in all): what fits is attached, the rest linked
  files[blob("2/scan.pdf")] = { bytes: Buffer.concat([Buffer.from("%PDF-1.7 "), Buffer.alloc(MAX_ATTACHMENT_BYTES)]), type: "application/pdf" }
  const m3 = await send(db)
  assert.deepEqual(fileParts(m3).map((a) => a.filename), ["invoice-INV-1001.pdf", "signed-DP-1.pdf"])
  assert.ok(m3.attachments!.reduce((n, a) => n + a.content.length, 0) <= MAX_ATTACHMENT_BYTES)
  assert.ok(m3.text.includes(`Signed delivery permit DP-2:\n    ${blob("2/scan.pdf")}`))
  assert.ok(m3.html.includes(`href="${blob("2/scan.pdf")}"`))

  // fitting: in permit order, a copy that doesn't fit is linked, a later smaller one still goes
  const a = (n: number) => ({ filename: "x.pdf", content: Buffer.alloc(n), contentType: "application/pdf" })
  const fit = fitAttachments([
    { permitId: 1, state: "attached", attachments: [a(60)], urls: ["u1"] },
    { permitId: 2, state: "attached", attachments: [a(50)], urls: ["u2"] },
    { permitId: 3, state: "attached", attachments: [a(30)], urls: ["u3"] },
  ], 100)
  assert.deepEqual(fit.map((c) => c.state), ["attached", "linked", "attached"])
})

test("M14. the customer card's 'Accountant email': preferred over the main e-mail; works without the column; saved by the customers API", async () => {
  const db = emailDb({ status: "valid" })
  db.tables.customers[0].accountant_email = "acc1@acme.com; Acc2@acme.com"
  const mail = fakeTransport()
  const deps = (): EmailDeps => ({ ...portalFake().deps, env: ENV, transport: mail.transport })
  resetPrintoutGuard()
  await sendInvoiceEmail(db, 1, { trigger: "manual" }, deps())
  assert.deepEqual(mail.sent[0].to, ["acc1@acme.com", "acc2@acme.com"])
  // empty accountant e-mail -> the main one; both empty -> "no_email"
  db.tables.customers[0].accountant_email = " "
  resetPrintoutGuard()
  await sendInvoiceEmail(db, 1, { trigger: "manual" }, deps())
  assert.deepEqual(mail.sent[1].to, ["buyer@acme.com", "accounts@acme.com"])
  db.tables.customers[0].email = ""
  assert.equal((await sendInvoiceEmail(db, 1, { trigger: "manual" }, deps())).status, "no_email")

  // before the database update the column is missing: the main e-mail, nothing fails
  const old = emailDb({ status: "valid" })
  const from = old.from.bind(old)
  ;(old as any).from = (table: string) => {
    const q: any = from(table)
    if (table !== "customers") return q
    const select = q.select.bind(q)
    q.select = (cols: string, o?: any) =>
      String(cols).includes("accountant_email") ? failing({ code: "42703", message: "column customers.accountant_email does not exist" }) : select(cols, o)
    return q
  }
  resetPrintoutGuard()
  assert.equal((await sendInvoiceEmail(old, 1, { trigger: "manual" }, deps())).status, "sent")
  assert.deepEqual(mail.sent[2].to, ["buyer@acme.com", "accounts@acme.com"])

  // the customers API reads and writes it; without the column the rest is saved with a warning
  const cdb = new FakeDb({ customers: [{ customer_id: 5, customer_name: "Acme", email: "a@acme.com", created_at: "2026-01-01" }] })
  cdb.jitter = false
  useDb(cdb)
  const put = await customersRoute.PUT(rq("PUT", "/api/customers", { id: "5", accountantEmail: " acc@acme.com, b@acme.com " }))
  assert.equal(put.status, 200)
  assert.equal((await put.json()).accountantEmail, "acc@acme.com, b@acme.com")
  assert.equal(cdb.tables.customers[0].accountant_email, "acc@acme.com, b@acme.com")
  assert.equal((await (await customersRoute.GET()).json())[0].accountantEmail, "acc@acme.com, b@acme.com")
  // (the fake database numbers no customers, so only the stored row is checked)
  await customersRoute.POST(rq("POST", "/api/customers", { name: "New Co", email: "n@new.com", accountantEmail: " acc@new.com " }))
  assert.equal(cdb.tables.customers.find((c) => c.customer_name === "New Co")!.accountant_email, "acc@new.com")
  const cfrom = cdb.from.bind(cdb)
  ;(cdb as any).from = (table: string) => {
    const q: any = cfrom(table)
    const update = q.update.bind(q)
    q.update = (patch: any) =>
      table === "customers" && "accountant_email" in patch
        ? failing({ code: "PGRST204", message: "Could not find the 'accountant_email' column of 'customers' in the schema cache" })
        : update(patch)
    return q
  }
  const noColumn = await customersRoute.PUT(rq("PUT", "/api/customers", { id: "5", phone: "0100", accountantEmail: "x@acme.com" }))
  assert.equal(noColumn.status, 200)
  assert.deepEqual((await noColumn.json()).taxWarnings, ["accountant_email: not saved, database update needed"])
  assert.equal(cdb.tables.customers[0].phone, "0100")
  // an empty field on a database without the column: saved quietly
  const quiet = await customersRoute.PUT(rq("PUT", "/api/customers", { id: "5", phone: "0101", accountantEmail: "" }))
  assert.equal((await quiet.json()).taxWarnings, undefined)

  // the screens: the card, the create form and the edit dialog show it; both languages have the texts
  const card = readFileSync(join(REPO, "components/modules/customer-module.tsx"), "utf8")
  assert.match(card, /selectedCustomer\.accountantEmail/)
  assert.match(card, /formData\.accountantEmail/)
  const dialog = readFileSync(join(REPO, "components/parties/edit-party-dialog.tsx"), "utf8")
  assert.match(dialog, /field\("accountantEmail", t\("customer\.accountant-email"\)\)/)
  const i18n = readFileSync(join(REPO, "lib/i18n-context.tsx"), "utf8")
  const arAt = i18n.indexOf("\n  ar: {")
  assert.ok(i18n.slice(arAt).includes('"customer.accountant-email": "بريد المحاسب"'))
  assert.ok(i18n.slice(0, arAt).includes('"customer.accountant-email": "Accountant email"'))
  for (const k of ["customer.accountant-email-hint", "customer.accountant-email-none", "customer.accountant-email-not-saved"])
    assert.ok(i18n.slice(0, arAt).includes(`"${k}":`) && i18n.slice(arAt).includes(`"${k}":`), k)
})

test("M15. an invoice handled manually ('already on the portal') with its tax portal ID saved can be e-mailed; without the ID it cannot", async () => {
  const manualDb = (uuid: string | null) => {
    const db = emailDb()
    // as POST /api/eta/preview stores it: no environment, no body, only the ID typed in
    db.tables.eta_documents = [{ doc_id: 9, invoice_id: 1, document_type: "I", status: "manual", eta_uuid: uuid, created_at: "2026-11-20T09:00:00Z" }]
    return db
  }
  const db = manualDb("UUID-OLD")
  const fake = portalFake()
  const mail = fakeTransport()
  const res = await pressSend(db, mail, fake.portal)
  assert.equal(res.status, 200)
  assert.deepEqual(fake.calls.printout, ["UUID-OLD"], "the PDF comes from the real portal by the saved ID")
  assert.equal(mail.sent.length, 1)
  const m = mail.sent[0]
  for (const s of ["Acme Trading", "INV-1001", "20/11/2026", "342.00", "UUID-OLD"]) assert.ok(m.text.includes(s), s)
  assert.equal(fileParts(m)[0].content.toString(), "%PDF-1.7 portal")
  const log = db.tables.invoice_email_log
  assert.equal(log.length, 1)
  assert.equal(log[0].status, "sent")
  assert.equal(log[0].eta_uuid, "UUID-OLD")
  assert.equal(log[0].environment, "real")

  // no ID saved -> nothing sent, "no valid e-invoice"
  const bare = manualDb(null)
  const mail2 = fakeTransport()
  const res2 = await pressSend(bare, mail2)
  assert.equal(res2.status, 409)
  assert.equal((await res2.json()).code, "not_valid")
  assert.equal(mail2.sent.length, 0)

  // the window shows the e-mail section for such an invoice too
  const dialog = readFileSync(join(REPO, "components/accounting/eta-preview-dialog.tsx"), "utf8")
  assert.match(dialog, /preview\.handledManually && preview\.manualEtaUuid[^\n]*<EtaEmailStatus/)
})

// The password before anything goes to the tax portal (owner request 2026-11-25): it lives only in ETA_SEND_PIN.
test("portal password: right / wrong / missing, and every portal route refuses a wrong one before doing anything", async () => {
  const { portalPinOk, portalPinRefusal } = await import("../eta/portal-pin")
  const env = { ETA_SEND_PIN: "1234" }
  assert.equal(portalPinOk({ pin: "1234" }, env), true)
  assert.equal(portalPinOk({ pin: " 1234 " }, env), true)
  assert.equal(portalPinOk({ pin: "1235" }, env), false)
  assert.equal(portalPinOk({}, env), false)
  assert.equal(portalPinOk(null, env), false)
  assert.equal(portalPinOk({ pin: 1234 }, env), false)
  assert.equal(portalPinOk({}, {}), true, "no password set: nothing is asked")
  const refusal = portalPinRefusal({ pin: "x" }, env)!
  assert.equal(refusal.status, 403)
  assert.equal((await refusal.json()).code, "wrong_pin")
  assert.equal(portalPinRefusal({ pin: "1234" }, env), null)
  const before = process.env.ETA_SEND_PIN
  process.env.ETA_SEND_PIN = "1234"
  try {
    for (const name of ["send", "send-again", "credit-note", "cancel"]) {
      const route = await import(`../../app/api/eta/${name}/route`)
      const res = await route.POST(new Request(`http://x/api/eta/${name}`, { method: "POST", body: JSON.stringify({ invoiceIds: [1], invoiceId: 1, docId: 1, pin: "0000" }) }))
      assert.equal(res.status, 403, name)
      assert.equal((await res.json()).code, "wrong_pin", name)
    }
  } finally {
    if (before === undefined) delete process.env.ETA_SEND_PIN
    else process.env.ETA_SEND_PIN = before
  }
  // the screens send the password with every portal action
  const dialog = readFileSync(join(REPO, "components/accounting/eta-preview-dialog.tsx"), "utf8")
  assert.match(dialog, /portalPin\.ask\(\)/)
  const bits = readFileSync(join(REPO, "components/accounting/eta-ar-bits.tsx"), "utf8")
  assert.match(bits, /invoiceIds: invoiceIds\.slice\(0, 100\), pin/)
})

test("M16. the company logo sits in the e-mail's header as an embedded image (not a file to download); no logo -> still sent", async () => {
  const png = Buffer.from("\x89PNG-logo")
  for (const logo of [png, null]) {
    const db = emailDb()
    const fake = portalFake()
    const mail = fakeTransport()
    await withDefaults({ env: ENV, transport: mail.transport }, {}, () => followUpQuietly(db, fake.deps))
    const res = await pressSend(db, mail, fake.portal, NOW, { loadLogo: async () => logo })
    assert.equal(res.status, 200)
    const m = mail.sent[0]
    const inline = m.attachments!.filter((a) => a.cid)
    if (logo) {
      assert.equal(inline.length, 1)
      assert.ok(inline[0].content.equals(png))
      assert.match(m.html, new RegExp(`src="cid:${inline[0].cid}"`))
    } else {
      assert.equal(inline.length, 0)
      assert.ok(!m.html.includes("cid:"))
    }
    assert.equal(m.attachments!.filter((a) => !a.cid).length, 1, "the e-invoice PDF is still the one file")
  }
  // in the MIME: the logo is an inline part with its Content-ID, the PDF a normal attachment
  const { mime } = buildMime({
    from: { name: "Misr Motors", address: "misrmotors.invoices@gmail.com" }, to: ["buyer@acme.com"], subject: "s", text: "t", html: '<img src="cid:logo@misrmotors">',
    attachments: [{ filename: "logo.png", content: png, contentType: "image/png", cid: "logo@misrmotors" }, { filename: "invoice.pdf", content: Buffer.from("%PDF"), contentType: "application/pdf" }],
  }, { boundarySeed: "x" })
  assert.match(mime, /multipart\/related; boundary="rel_x"/)
  assert.match(mime, /Content-ID: <logo@misrmotors>\r\nContent-Disposition: inline; filename="logo.png"/)
  assert.match(mime, /Content-Disposition: attachment; filename="invoice.pdf"/)
  assert.ok(mime.indexOf("--rel_x--") < mime.indexOf('filename="invoice.pdf"'))
  // the real logo file the printed invoices use is there
  assert.ok(readFileSync(join(REPO, "public/images/image.png")).length > 0)
})
