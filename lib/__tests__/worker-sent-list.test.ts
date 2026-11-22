// The worker's own sent list on his upload link page, and freed invoice numbers (owner, 2026-11-22).
import "./route-harness"
import test from "node:test"
import assert from "node:assert/strict"
import { FakeDb } from "./fake-db"
import { jsonRequest, useDb } from "./route-harness"
import { hashSecret } from "../maintenance-photos"
import { workerSentList } from "../worker-sent-list"
import { freedMinvNumbers, nextMinvNumber, minvNumber } from "../maintenance-booklets"
import { invoiceYear2 } from "../invoice-codes"
import { createStandaloneMinv } from "../invoicing"
import { TAKEN_BACK_NOTE, freedSharedNumbers, nextSharedNumber, takeWorkerNumber, workerNumberAction } from "../shared-invoice-numbers"
import * as sentRoute from "../../app/api/worker-upload/[secret]/sent/route"
import * as draftRoute from "../../app/api/maintenance/photo-drafts/[id]/route"

const Y = invoiceYear2()
const M = (serial: number) => minvNumber(Y, serial)
const SECRET_A = "A".repeat(32)
const SECRET_B = "B".repeat(32)
const LINE = [{ description: "x", quantity: 1, unitPrice: 100 }]

function sentDb() {
  const db = new FakeDb({
    maintenance_upload_links: [
      { id: 1, worker_name: "Ahmed", active: true, secret_hash: hashSecret(SECRET_A) },
      { id: 2, worker_name: "Mostafa", active: true, secret_hash: hashSecret(SECRET_B) },
    ],
    customers: [
      { customer_id: 7, customer_name: "Nile Garage" },
      { customer_id: 8, customer_name: "Other Worker's Customer" },
    ],
    accounts_receivable: [
      { invoice_id: 50, invoice_number: M(10), amount: 1140, status: "pending", customer_id: 7 },
      { invoice_id: 51, invoice_number: `X51-${M(11)}`, amount: 570, status: "cancelled", customer_id: 7 },
      { invoice_id: 60, invoice_number: M(12), amount: 99999, status: "pending", customer_id: 8 },
    ],
    maintenance_photo_drafts: [
      { id: 1, link_id: 1, created_at: "2026-11-20T08:00:00Z", status: "converted", invoice_id: 50, invoice_number: M(10), read_data: null },
      { id: 2, link_id: 1, created_at: "2026-11-21T08:00:00Z", status: "rejected", reject_reason: "Photo is blurry", invoice_number: null, read_data: { customerName: "Read Name", writtenTotal: 0, lines: [{ name: "a", quantity: 2, unitPrice: 50 }] } },
      { id: 3, link_id: 1, created_at: "2026-11-21T09:00:00Z", status: "rejected", reject_reason: "Torn page (1500)", invoice_number: "1500", read_data: null },
      { id: 4, link_id: 1, created_at: "2026-11-21T10:00:00Z", status: "rejected", reject_reason: null, invoice_id: 51, invoice_number: M(11), read_data: null },
      { id: 5, link_id: 1, created_at: "2026-11-22T07:00:00Z", status: "waiting", invoice_number: null, read_data: { customerName: "Hassan", writtenTotal: 285, printedNumber: M(13), lines: [] } },
      { id: 6, link_id: 2, created_at: "2026-11-22T08:00:00Z", status: "converted", invoice_id: 60, invoice_number: M(12), read_data: null },
    ],
    maintenance_booklet_voids: [],
  })
  db.jitter = false
  return db
}

const getSent = async (db: FakeDb, secret: string) => {
  useDb(db)
  const res = await sentRoute.GET(jsonRequest("GET"), { params: Promise.resolve({ secret }) })
  return { status: res.status, body: (await res.json()) as any }
}

test("W1. the worker sees only his own photos, newest first, with plain statuses", async () => {
  const items = await workerSentList(sentDb(), 1)
  assert.deepEqual(items.map((i) => i.id), [5, 4, 3, 2, 1])
  const by = new Map(items.map((i) => [i.id, i]))
  assert.deepEqual(
    { status: by.get(5)!.status, number: by.get(5)!.number, customer: by.get(5)!.customer, total: by.get(5)!.total },
    { status: "review", number: M(13), customer: "Hassan", total: 285 },
  )
  assert.deepEqual(
    { status: by.get(1)!.status, number: by.get(1)!.number, customer: by.get(1)!.customer, total: by.get(1)!.total },
    { status: "created", number: M(10), customer: "Nile Garage", total: 1140 },
  )
  assert.deepEqual({ status: by.get(2)!.status, reason: by.get(2)!.reason, total: by.get(2)!.total }, { status: "rejected", reason: "Photo is blurry", total: 100 })
  // a cancelled page (void) and a cancelled invoice both read "cancelled"; the page reason loses its "(number)" tail
  assert.deepEqual({ status: by.get(3)!.status, reason: by.get(3)!.reason, number: by.get(3)!.number }, { status: "cancelled", reason: "Torn page", number: "1500" })
  assert.deepEqual({ status: by.get(4)!.status, number: by.get(4)!.number }, { status: "cancelled", number: M(11) })
  // never another worker's invoice, customer or price
  const text = JSON.stringify(items)
  assert.ok(!text.includes("99999") && !text.includes("Other Worker") && !text.includes(M(12)))
})

test("W2. the sent list route: the link secret is the key, same check as the upload", async () => {
  const db = sentDb()
  const mine = await getSent(db, SECRET_A)
  assert.equal(mine.status, 200)
  assert.equal(mine.body.items.length, 5)
  const other = await getSent(db, SECRET_B)
  assert.deepEqual(other.body.items.map((i: any) => i.id), [6])
  assert.equal((await getSent(db, "C".repeat(32))).status, 404) // unknown link
  assert.equal((await getSent(db, "short")).status, 404) // wrong shape
  db.tables.maintenance_upload_links[0].active = false
  assert.equal((await getSent(db, SECRET_A)).status, 404) // switched off
})

// ---- Freed numbers, old MINV numbering ---------------------------------------------------------------------
function minvDb() {
  const db = new FakeDb({
    customers: [{ customer_id: 1, customer_name: "C" }],
    accounts_receivable: [
      { invoice_id: 1, invoice_number: M(1), customer_id: 1, amount: 1, status: "pending" },
      { invoice_id: 2, invoice_number: M(2), customer_id: 1, amount: 1, status: "pending" },
      // created then cancelled: its number never goes out again
      { invoice_id: 4, invoice_number: `X4-${M(4)}`, customer_id: 1, amount: 1, status: "cancelled" },
      { invoice_id: 6, invoice_number: M(6), customer_id: 1, amount: 1, status: "pending" },
    ],
    maintenance_booklet_voids: [{ id: 1, booklet_id: null, invoice_number: M(5), reason: "Torn" }],
    maintenance_photo_drafts: [
      { id: 1, link_id: 1, status: "rejected", invoice_number: M(3), invoice_id: null },
      { id: 2, link_id: 1, status: "rejected", invoice_number: M(4), invoice_id: 4 },
      { id: 3, link_id: 1, status: "waiting", invoice_number: M(7), invoice_id: null },
    ],
    maintenance_booklets: [],
    company_settings: [],
  })
  db.jitter = false
  return db
}

test("F1. MINV: numbers cancelled before their invoice are offered next, lowest first; created ones never", async () => {
  const db = minvDb()
  assert.deepEqual(await freedMinvNumbers(db, Y), [M(3), M(5)])
  assert.equal(await nextMinvNumber(db), M(3))
})

test("F2. MINV: the office takes each freed number exactly once, then the sequence goes on", async () => {
  const db = minvDb()
  const made: string[] = []
  for (let i = 0; i < 3; i++) {
    const r = await createStandaloneMinv(db, { customerId: 1, amount: 114, lines: LINE })
    assert.equal(r.status, 200, JSON.stringify(r.body))
    made.push(r.body.invoice_number)
  }
  // 3 and 5 were freed; 4 was on a (cancelled) invoice and 7 is on a waiting photo, so the sequence continues at 8
  assert.deepEqual(made, [M(3), M(5), M(8)])
  assert.equal(await nextMinvNumber(db), M(9))
})

test("F3. MINV: two people at once never both get the same freed number", async () => {
  const db = minvDb()
  db.jitter = true
  const results = await Promise.all([1, 2, 3].map(() => createStandaloneMinv(db, { customerId: 1, amount: 114, lines: LINE })))
  const numbers = results.map((r) => r.body.invoice_number)
  assert.equal(new Set(numbers).size, 3, numbers.join(","))
  assert.ok(numbers.includes(M(3)) || numbers.includes(M(5)), numbers.join(","))
  assert.ok(!numbers.includes(M(4)) && !numbers.includes(M(1)) && !numbers.includes(M(7)), numbers.join(","))
})

// ---- Freed numbers, shared plain numbering -----------------------------------------------------------------
function sharedDb() {
  const now = new Date().toISOString()
  const slot = (number: number, status: string, extra: Record<string, any> = {}) => ({
    number, kind: "maintenance", status, link_id: 1, draft_id: null, invoice_id: null, note: null, created_at: now, updated_at: now, ...extra,
  })
  const db = new FakeDb({
    company_settings: [{ setting_key: "shared_invoice_start", setting_value: "1000" }],
    accounts_receivable: [
      { invoice_id: 9, invoice_number: "1000", customer_id: 1, amount: 1, status: "pending" },
      { invoice_id: 10, invoice_number: "X10-1004", cancelled_number: "1004", customer_id: 1, amount: 1, status: "cancelled" },
    ],
    invoice_number_slots: [
      slot(1000, "used", { invoice_id: 9 }),
      slot(1001, "released", { note: "spoiled" }),
      slot(1002, "released", { note: TAKEN_BACK_NOTE, kind: "sales" }),
      slot(1003, "reserved", { link_id: 2, draft_id: 77 }),
      // released by a bug or by hand after its invoice was made: still never reused (on an invoice)
      slot(1004, "released", { note: "cancelled by office" }),
      slot(1005, "released", { note: "cancelled by office" }),
    ],
    maintenance_upload_links: [{ id: 1, worker_name: "A", active: true }, { id: 2, worker_name: "B", active: true }, { id: 3, worker_name: "C", active: true }],
    maintenance_photo_drafts: [{ id: 77, link_id: 2, status: "waiting", invoice_number: "1003", created_at: now }],
  })
  db.jitter = false
  // The 2026-11-21 function (no reuse for workers): the next new number after every slot and invoice.
  db.rpcHandlers.take_invoice_number = ({ p_kind, p_link_id }: any) => {
    const own = db.tables.invoice_number_slots.find((s) => s.link_id === p_link_id && s.kind === "maintenance" && s.status === "reserved" && s.draft_id == null)
    if (p_kind === "maintenance" && own) return own.number
    const next = Math.max(1000, ...db.tables.invoice_number_slots.map((s) => Number(s.number) + 1))
    db.tables.invoice_number_slots.push({ number: next, kind: p_kind, status: "reserved", link_id: p_link_id, draft_id: null, invoice_id: null, note: null, created_at: now, updated_at: now })
    return next
  }
  return db
}

test("S1. shared: a freed number is offered next to the worker and to the office; numbers on invoices never", async () => {
  const db = sharedDb()
  assert.deepEqual(await freedSharedNumbers(db, 1000), [1001, 1005])
  assert.equal(await nextSharedNumber(db, 1000, 1000), 1001) // what the office panel shows as the next number
  assert.equal(await takeWorkerNumber(db, 3), 1001)
  // he asks again before photographing: the same number, not another one
  assert.equal(await takeWorkerNumber(db, 3), 1001)
  assert.equal(await takeWorkerNumber(db, 1), 1005)
  // nothing freed left: the sequence goes on after the highest number
  assert.equal(await takeWorkerNumber(db, 2), 1006)
  const slots = new Map(db.tables.invoice_number_slots.map((s) => [s.number, s]))
  assert.equal(slots.get(1002)!.status, "released") // taken back from a made invoice: not handed to a worker
  assert.equal(slots.get(1004)!.status, "released")
})

test("S2. shared: two workers at the same time never get the same freed number", async () => {
  const db = sharedDb()
  db.jitter = true
  const got = await Promise.all([1, 2, 3].map((link) => takeWorkerNumber(db, link)))
  assert.equal(new Set(got).size, 3, got.join(","))
  assert.deepEqual([...got].sort(), [1001, 1005, 1006])
})

test("S3. shared: the lock-holding database function is used when it is there", async () => {
  const db = sharedDb()
  let called: any = null
  db.rpcHandlers.take_maintenance_number = (args: any) => ((called = args), 4242)
  assert.equal(await takeWorkerNumber(db, 3), 4242)
  assert.deepEqual(called, { p_link_id: 3 })
  // the worker's "take" button goes through it
  const done = await workerNumberAction(db, 3, "take")
  assert.equal(done.ok, true)
})

test("S4. shared: rejecting a photo before its invoice frees the number; the next worker gets it", async () => {
  const db = sharedDb()
  useDb(db)
  const res = await draftRoute.POST(jsonRequest("POST", { action: "reject", reason: "blurry" }), { params: Promise.resolve({ id: "77" }) })
  assert.equal(res.status, 200)
  const slot = db.tables.invoice_number_slots.find((s) => s.number === 1003)!
  assert.equal(slot.status, "released")
  assert.equal(slot.draft_id, null)
  assert.equal(await takeWorkerNumber(db, 3), 1001)
  assert.equal(await takeWorkerNumber(db, 1), 1003)
})
