// Tests for invoice generation safety (Batch 1B): sales order -> invoice, delivery permit -> invoice, and
// the rules that stop the two from duplicating each other. Uses an in-memory stand-in for the Supabase client
// (no network, no real database). Run (from the repo root):
//   npx tsc lib/payment-type.ts lib/invoicing.ts lib/__tests__/invoicing.test.ts --outDir /tmp/inv-test \
//     --module commonjs --target es2020 --skipLibCheck --esModuleInterop && node --test /tmp/inv-test/__tests__/invoicing.test.js
import test from "node:test"
import assert from "node:assert/strict"
import { computeInvoiceAmount, createDpInvoices, createSoInvoice, round2 } from "../invoicing"

// ---------------------------------------------------------------------------------------------------------
// Minimal in-memory Supabase stand-in (only the calls lib/invoicing.ts makes)
// ---------------------------------------------------------------------------------------------------------
type Row = Record<string, any>
class FakeDb {
  tables: Record<string, Row[]> = {}
  failOn: Record<string, string> = {}
  seq: Record<string, number> = {}
  jitter = true
  constructor(seed: Record<string, Row[]>) {
    for (const [name, rows] of Object.entries(seed)) this.tables[name] = rows.map((r) => ({ ...r }))
    this.seq.accounts_receivable = Math.max(0, ...(this.tables.accounts_receivable || []).map((r) => r.invoice_id))
  }
  from(table: string) {
    this.tables[table] ||= []
    return new Query(this, table)
  }
  tick() {
    return new Promise((resolve) => setTimeout(resolve, this.jitter ? Math.random() * 4 : 0))
  }
}
class Query {
  op = "select"
  payload: any
  filters: ((r: Row) => boolean)[] = []
  wantRows = false
  one: "none" | "single" | "maybe" = "none"
  constructor(private db: FakeDb, private table: string) {}
  select() { this.wantRows = true; return this }
  insert(p: any) { this.op = "insert"; this.payload = p; return this }
  update(p: any) { this.op = "update"; this.payload = p; return this }
  delete() { this.op = "delete"; return this }
  eq(c: string, v: any) { this.filters.push((r) => r[c] === v); return this }
  neq(c: string, v: any) { this.filters.push((r) => r[c] !== v); return this }
  in(c: string, vs: any[]) { this.filters.push((r) => vs.includes(r[c])); return this }
  like(c: string, pattern: string) {
    const re = new RegExp("^" + pattern.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/%/g, ".*") + "$")
    this.filters.push((r) => re.test(String(r[c] ?? "")))
    return this
  }
  single() { this.one = "single"; return this }
  maybeSingle() { this.one = "maybe"; return this }
  then(resolve: any, reject: any) { return this.run().then(resolve, reject) }
  private fail() {
    const message = this.db.failOn[`${this.table}:${this.op}`]
    return message ? { data: null, error: { message, code: "XX000" } } : null
  }
  private shape(rows: Row[]) {
    if (this.one === "none") return { data: rows.map((r) => ({ ...r })), error: null }
    if (this.one === "maybe") return { data: rows[0] ? { ...rows[0] } : null, error: null }
    return rows[0] ? { data: { ...rows[0] }, error: null } : { data: null, error: { message: "no rows", code: "PGRST116" } }
  }
  async run(): Promise<any> {
    await this.db.tick()
    const injected = this.fail()
    if (injected) return injected
    if (this.op === "insert") {
      await this.db.tick()
      const rows = this.db.tables[this.table] // read after the latency so a concurrent delete is not undone
      const inserted: Row[] = []
      for (const item of Array.isArray(this.payload) ? this.payload : [this.payload]) {
        if (this.table === "invoice_delivery_permits" && rows.some((r) => r.permit_id === item.permit_id))
          return { data: null, error: { code: "23505", message: "duplicate permit_id" } }
        if (this.table === "accounts_receivable") {
          if (rows.some((r) => r.invoice_number === item.invoice_number))
            return { data: null, error: { code: "23505", message: "duplicate invoice_number" } }
          const row = { ...item, invoice_id: ++this.db.seq.accounts_receivable }
          rows.push(row)
          inserted.push(row)
          continue
        }
        rows.push({ ...item })
        inserted.push(item)
      }
      return this.wantRows ? this.shape(inserted) : { data: null, error: null }
    }
    await this.db.tick() // latency before the statement; match + apply below are one synchronous step
    const rows = this.db.tables[this.table]
    const matched = rows.filter((r) => this.filters.every((f) => f(r)))
    if (this.op === "update") {
      matched.forEach((r) => Object.assign(r, this.payload))
      return this.wantRows ? this.shape(matched) : { data: null, error: null }
    }
    if (this.op === "delete") {
      this.db.tables[this.table] = rows.filter((r) => !matched.includes(r))
      return { data: null, error: null }
    }
    return this.shape(matched)
  }
}

// ---------------------------------------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------------------------------------
// SO 1: 100 units @ 10,000 = 1,000,000 (+14% VAT = 1,140,000). No discount.
const SO1 = { so_id: 1, so_number: "SO-T-1", customer_id: 5, total: 1140000, subtotal: 1000000, discount_amount: 0, payment_type: "bank_transfer", payment_terms: "prepaid", installments: 6 }
const dp = (id: number, so: number, qty: number, status = "APPROVED") => ({ permit_id: id, permit_no: `DP-T-${id}`, sales_order_id: so, status })
const dpItem = (permit: number, qty: number, price = 10000) => ({ permit_id: permit, product_id: 7, item_name_snapshot: "Pump", quantity: qty, unit_price: price, total: qty * price })

function baseDb(extra: Record<string, Row[]> = {}) {
  return new FakeDb({
    sales_orders: [SO1],
    customers: [{ customer_id: 5, customer_name: "Test Customer" }],
    sales_order_items: [{ so_id: 1, product_id: 7, outsourced_name: null, quantity: 100 }],
    delivery_permits: [dp(1, 1, 40), dp(2, 1, 35), dp(3, 1, 25), dp(4, 1, 30)],
    delivery_permit_items: [dpItem(1, 40), dpItem(2, 35), dpItem(3, 25), dpItem(4, 30)],
    invoice_delivery_permits: [],
    accounts_receivable: [],
    ...extra,
  })
}
const invoicesOf = (db: FakeDb) => db.tables.accounts_receivable
const linksOf = (db: FakeDb) => db.tables.invoice_delivery_permits

// ---------------------------------------------------------------------------------------------------------
// Direct sales order path
// ---------------------------------------------------------------------------------------------------------
test("1-2. SO with no invoices -> whole-order invoice at the SO total, no DP links", async () => {
  const db = baseDb()
  const res = await createSoInvoice(db, 1)
  assert.equal(res.status, 200)
  assert.equal(res.body.amount, 1140000)
  assert.equal(res.body.so_id, 1)
  assert.equal(res.body.invoiceNumber, res.body.invoice_number)
  assert.match(res.body.invoice_number, /^INV-\d{4}-0001$/)
  assert.equal(linksOf(db).length, 0)
  assert.equal(res.body.source_delivery_permit_id ?? null, null)
  assert.equal(res.body.installment_months, 1) // bank transfer = single payment (Batch 1C)
})

test("3. a second whole-order invoice is rejected", async () => {
  const db = baseDb()
  assert.equal((await createSoInvoice(db, 1)).status, 200)
  const second = await createSoInvoice(db, 1)
  assert.equal(second.status, 409)
  assert.equal(invoicesOf(db).length, 1)
})

test("4. an SO already invoiced through a DP rejects the whole-order invoice", async () => {
  const db = baseDb()
  assert.equal((await createDpInvoices(db, [1])).status, 200)
  const res = await createSoInvoice(db, 1)
  assert.equal(res.status, 409)
  assert.match(res.body.error, /delivery permits/i)
  assert.equal(invoicesOf(db).length, 1)
})

test("unknown SO -> 404; query error fails closed (500), never creates an invoice", async () => {
  const db = baseDb()
  assert.equal((await createSoInvoice(db, 99)).status, 404)
  db.failOn["accounts_receivable:select"] = "boom"
  const res = await createSoInvoice(db, 1)
  assert.equal(res.status, 500)
  assert.equal(invoicesOf(db).length, 0)
})

// ---------------------------------------------------------------------------------------------------------
// Delivery permit path
// ---------------------------------------------------------------------------------------------------------
test("5, 17. partial DP -> invoice for only that DP; provenance points at the DP", async () => {
  const db = baseDb()
  const res = await createDpInvoices(db, [1])
  assert.equal(res.status, 200)
  const invoice = res.body.invoices[0]
  assert.equal(invoice.amount, 456000) // 40 x 10,000 x 1.14
  assert.equal(invoice.source_delivery_permit_id, 1)
  assert.equal(invoice.so_id, 1)
  assert.deepEqual(linksOf(db).map((l) => l.permit_id), [1])
  assert.equal(db.tables.delivery_permits.find((p) => p.permit_id === 1)!.invoice_id, invoice.invoice_id)
  assert.equal(db.tables.delivery_permits.find((p) => p.permit_id === 2)!.invoice_id, undefined)
})

test("6-8, 14. remaining quantity stays invoiceable; 40 / 35 / 25 accumulate to the SO total", async () => {
  const db = baseDb()
  const amounts: number[] = []
  for (const id of [1, 2, 3]) {
    const res = await createDpInvoices(db, [id])
    assert.equal(res.status, 200, `DP${id}: ${JSON.stringify(res.body)}`)
    amounts.push(res.body.invoices[0].amount)
  }
  assert.deepEqual(amounts, [456000, 399000, 285000])
  assert.equal(round2(amounts.reduce((a, b) => a + b, 0)), 1140000)
  assert.equal(invoicesOf(db).length, 3)
  assert.deepEqual(invoicesOf(db).map((i) => i.source_delivery_permit_id), [1, 2, 3])
})

test("9. cumulative DP invoices cannot exceed the ordered quantity", async () => {
  const db = baseDb()
  assert.equal((await createDpInvoices(db, [1])).status, 200) // 40
  assert.equal((await createDpInvoices(db, [2])).status, 200) // 35 -> 75
  const over = await createDpInvoices(db, [4]) // 30 > 25 remaining
  assert.equal(over.status, 409)
  assert.match(over.body.error, /only 25 of 100 ordered remain/)
  assert.equal(invoicesOf(db).length, 2)
  assert.equal((await createDpInvoices(db, [3])).status, 200) // exactly the remaining 25
})

test("9b. cumulative value cannot exceed the SO total (same quantities, inflated prices)", async () => {
  const db = baseDb()
  db.tables.delivery_permit_items = [dpItem(1, 40), dpItem(2, 35, 20000)] // DP2 priced above the SO line
  assert.equal((await createDpInvoices(db, [1])).status, 200)
  const res = await createDpInvoices(db, [2]) // 35 x 20,000 x 1.14 = 798,000 > 684,000 left
  assert.equal(res.status, 409)
  assert.match(res.body.error, /exceed/)
})

test("10. the same DP cannot be invoiced twice (sequential and concurrent)", async () => {
  const db = baseDb()
  assert.equal((await createDpInvoices(db, [1])).status, 200)
  assert.equal((await createDpInvoices(db, [1])).status, 400)
  const racing = baseDb()
  const results = await Promise.all([createDpInvoices(racing, [1]), createDpInvoices(racing, [1]), createDpInvoices(racing, [1])])
  assert.equal(results.filter((r) => r.status === 200).length, 1, JSON.stringify(results.map((r) => r.body)))
  assert.equal(invoicesOf(racing).length, 1)
  assert.equal(linksOf(racing).length, 1)
})

test("11. a fully invoiced SO cannot take another DP invoice", async () => {
  const db = baseDb()
  db.tables.delivery_permits.push(dp(9, 1, 5))
  db.tables.delivery_permit_items.push(dpItem(9, 5))
  for (const id of [1, 2, 3]) assert.equal((await createDpInvoices(db, [id])).status, 200)
  const extra = await createDpInvoices(db, [9])
  assert.equal(extra.status, 409)
  assert.equal(invoicesOf(db).length, 3)
})

test("DP must be APPROVED; one invoice may cover several DPs (no source_delivery_permit_id then)", async () => {
  const db = baseDb()
  db.tables.delivery_permits[1].status = "DRAFT"
  const notApproved = await createDpInvoices(db, [1, 2])
  assert.equal(notApproved.status, 400)
  assert.equal(invoicesOf(db).length, 0)
  db.tables.delivery_permits[1].status = "APPROVED"
  const both = await createDpInvoices(db, [1, 2])
  assert.equal(both.status, 200)
  assert.equal(both.body.invoices[0].amount, 855000) // 75 x 10,000 x 1.14
  assert.equal(both.body.invoices[0].source_delivery_permit_id ?? null, null)
  assert.deepEqual(linksOf(db).map((l) => l.permit_id).sort(), [1, 2])
})

// ---------------------------------------------------------------------------------------------------------
// Cross-path protection
// ---------------------------------------------------------------------------------------------------------
test("12. a whole-order invoice blocks every later DP invoice", async () => {
  const db = baseDb()
  assert.equal((await createSoInvoice(db, 1)).status, 200)
  const res = await createDpInvoices(db, [1])
  assert.equal(res.status, 409)
  assert.match(res.body.error, /invoiced in full/)
  assert.equal(invoicesOf(db).length, 1)
})

test("13. a DP invoice blocks the whole-order invoice (see 4) and the remaining items continue via DPs", async () => {
  const db = baseDb()
  assert.equal((await createDpInvoices(db, [1])).status, 200)
  assert.equal((await createSoInvoice(db, 1)).status, 409)
  assert.equal((await createDpInvoices(db, [2])).status, 200)
})

// ---------------------------------------------------------------------------------------------------------
// Concurrency (no transaction; lowest invoice_id wins)
// ---------------------------------------------------------------------------------------------------------
test("concurrent: two DP invoices that together exceed the SO -> exactly one survives", async () => {
  for (let trial = 0; trial < 25; trial++) {
    const db = baseDb()
    // after DP1 (40) only 60 remain; DP2 (35) + DP4 (30) = 65 > 60
    assert.equal((await createDpInvoices(db, [1])).status, 200)
    const [a, b] = await Promise.all([createDpInvoices(db, [2]), createDpInvoices(db, [4])])
    const wins = [a, b].filter((r) => r.status === 200).length
    assert.equal(wins, 1, `trial ${trial}: ${JSON.stringify([a.body, b.body])}`)
    assert.equal(invoicesOf(db).length, 2, `trial ${trial}`)
  }
})

test("concurrent: whole-order invoice racing a DP invoice -> never both", async () => {
  for (let trial = 0; trial < 25; trial++) {
    const db = baseDb()
    const [so, dpRes] = await Promise.all([createSoInvoice(db, 1), createDpInvoices(db, [1])])
    const wins = [so, dpRes].filter((r) => r.status === 200).length
    assert.ok(wins <= 1, `trial ${trial}: both succeeded`)
    assert.ok(invoicesOf(db).length <= 1, `trial ${trial}: ${invoicesOf(db).length} invoices`)
  }
})

test("concurrent: two whole-order invoices -> exactly one", async () => {
  for (let trial = 0; trial < 25; trial++) {
    const db = baseDb()
    const results = await Promise.all([createSoInvoice(db, 1), createSoInvoice(db, 1)])
    assert.equal(results.filter((r) => r.status === 200).length, 1, `trial ${trial}`)
    assert.equal(invoicesOf(db).length, 1)
  }
})

test("concurrent: invoice numbers stay unique", async () => {
  const db = baseDb()
  const results = await Promise.all([createDpInvoices(db, [1]), createDpInvoices(db, [2]), createDpInvoices(db, [3])])
  const numbers = invoicesOf(db).map((i) => i.invoice_number)
  assert.equal(new Set(numbers).size, numbers.length)
  assert.ok(results.some((r) => r.status === 200))
})

test("link/compat failures roll the invoice back completely", async () => {
  const db = baseDb()
  db.failOn["delivery_permits:update"] = "boom"
  const res = await createDpInvoices(db, [1])
  assert.equal(res.status, 500)
  assert.equal(invoicesOf(db).length, 0)
  assert.equal(linksOf(db).length, 0)
})

// ---------------------------------------------------------------------------------------------------------
// Amount / document consistency
// ---------------------------------------------------------------------------------------------------------
test("15-16. stored amount == amount the document prints; discount + VAT rule unchanged (SO 7 figures)", async () => {
  // Real SO 7: subtotal 929,757.60, discount 18,595.15; DP3 items 864,957.60, DP4 items 64,800.
  assert.equal(computeInvoiceAmount(864957.6, 929757.6, 18595.15), 966330.63) // INV-2026-0005
  assert.equal(computeInvoiceAmount(64800, 929757.6, 18595.15), 72394.56)
  // Legacy formula from create-from-dps, copied verbatim
  const legacy = (raw: number, sub: number, disc: number) => raw * (1 - (sub > 0 ? disc / sub : 0)) * (1 + 0.14)
  for (const raw of [1000, 64800, 864957.6, 12345.67]) assert.equal(computeInvoiceAmount(raw, 929757.6, 18595.15), round2(legacy(raw, 929757.6, 18595.15)))

  const db = baseDb({ sales_orders: [{ ...SO1, subtotal: 1000000, discount_amount: 100000, total: 1026000 }] })
  const res = await createDpInvoices(db, [1, 2]) // 75 units
  const stored = res.body.invoices[0].amount
  const printed = computeInvoiceAmount(75 * 10000, 1000000, 100000) // what the PDF route computes
  assert.equal(stored, printed)
  assert.equal(stored, 769500)
})

test("whole-order invoice: stored amount is the SO total (the document prints the stored amount)", async () => {
  const db = baseDb({ sales_orders: [{ ...SO1, subtotal: 1000000, discount_amount: 100000, total: 1026000 }] })
  const res = await createSoInvoice(db, 1)
  assert.equal(res.body.amount, 1026000)
})

// ---------------------------------------------------------------------------------------------------------
// Historical state: the new rules handle the real database as-is (SO 7 / INV-2 / INV-5 shape)
// ---------------------------------------------------------------------------------------------------------
test("existing over-invoiced SO (INV-2 priced at the whole SO, linked to DP4) accepts nothing further", async () => {
  const db = new FakeDb({
    sales_orders: [{ so_id: 7, so_number: "SO-2026-0004", customer_id: 2, total: 1038725.19, subtotal: 929757.6, discount_amount: 18595.15, payment_type: "bank_transfer", payment_terms: "prepaid", installments: 6 }],
    customers: [],
    sales_order_items: [
      { so_id: 7, product_id: 4, outsourced_name: null, quantity: 40 },
      { so_id: 7, product_id: 1, outsourced_name: null, quantity: 3 },
      { so_id: 7, product_id: null, outsourced_name: "korek", quantity: 3 },
    ],
    delivery_permits: [dp(3, 7, 0), dp(4, 7, 0), dp(10, 7, 0)],
    delivery_permit_items: [
      { permit_id: 3, product_id: 4, item_name_snapshot: "x", quantity: 40, unit_price: 21600, total: 864000 },
      { permit_id: 3, product_id: 1, item_name_snapshot: "y", quantity: 3, unit_price: 319.2, total: 957.6 },
      { permit_id: 4, product_id: null, item_name_snapshot: "korek", quantity: 3, unit_price: 21600, total: 64800 },
      { permit_id: 10, product_id: 4, item_name_snapshot: "x", quantity: 1, unit_price: 21600, total: 21600 },
    ],
    invoice_delivery_permits: [{ invoice_id: 2, permit_id: 4 }, { invoice_id: 5, permit_id: 3 }],
    accounts_receivable: [
      { invoice_id: 2, invoice_number: "INV-2026-0002", so_id: 7, amount: 1038725.19 },
      { invoice_id: 5, invoice_number: "INV-2026-0005", so_id: 7, amount: 966330.63 },
    ],
  })
  assert.equal((await createSoInvoice(db, 7)).status, 409)
  const extra = await createDpInvoices(db, [10])
  assert.equal(extra.status, 409)
  assert.equal(invoicesOf(db).length, 2) // historical rows untouched
  assert.equal(invoicesOf(db)[0].amount, 1038725.19)
})
