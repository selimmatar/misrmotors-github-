// CEO chat with lookups and confirm-first actions (owner request, 2026-11-14).
import "./route-harness"
import test from "node:test"
import assert from "node:assert/strict"
import { FakeDb } from "./fake-db"
import { call, useDb } from "./route-harness"
import { businessSummary, matches, runTool } from "../ai/ceo-tools"
import * as chatRoute from "../../app/api/ai/ceo-chat/route"
import * as confirmRoute from "../../app/api/ai/ceo-chat/confirm/route"

function seed() {
  const db = new FakeDb({
    customers: [{ customer_id: 5, customer_name: "Bostanji " }, { customer_id: 6, customer_name: "افاتار" }],
    suppliers: [{ supplier_id: 9, supplier_name: "مصطفي " }, { supplier_id: 10, supplier_name: "AMA" }],
    products: [{ product_id: 7, product_name: "Drill 20V", sku: "DR-20", unit_price: 1500, last_landed_cost: 900 }],
    warehouses: [{ warehouse_id: 1, warehouse_name: "Main" }],
    inventory: [{ inventory_id: 1, product_id: 7, warehouse_id: 1, quantity: 4, unit_cost: 900, reorder_point: 5, is_returned: false }],
    sales_orders: [{ so_id: 4, so_number: "SO-2026-507661", customer_id: 5, status: "accountant_approved", fulfillment_status: "PARTIALLY_DELIVERED", total: 10000, subtotal: 10000, discount_amount: 0, created_at: "2026-11-01T10:00:00" }],
    sales_order_items: [{ so_item_id: 60, so_id: 4, product_id: null, outsourced_name: "تزجه", item_type: "outsourced", quantity: 5, unit_price: 2000, total: 10000, cost_estimate: 1500 }],
    delivery_permits: [],
    delivery_permit_items: [],
    product_returns: [],
    return_items: [],
    purchase_orders: [{ po_id: 7, po_number: "PO-2026-801226", supplier_id: 9, status: "approved", total: 45000, created_at: "2026-11-02T10:00:00" }],
    purchase_order_items: [],
    goods_receipt_lines: [],
    accounts_receivable: [
      { invoice_id: 1, invoice_number: "INV-1", customer_id: 5, so_id: 4, amount: 5000, balance: 2000, due_date: "2026-01-01", status: "partial" },
      { invoice_id: 2, invoice_number: "INV-2", customer_id: 5, so_id: 4, amount: 3000, balance: 0, due_date: "2026-01-01", status: "paid" },
    ],
    accounts_payable: [],
    invoice_delivery_permits: [],
    customer_payments: [],
    supplier_credits: [],
    balance_entries: [{ entry_id: 1, amount: 12345, created_at: "2026-11-10T00:00:00" }],
    sales_quotations: [{ id: 3, quotation_number: "QT-1" }],
    sales_quotation_items: [],
    workflow_events: [],
    users: [{ user_id: 1, full_name: "Selim" }],
  })
  db.rpcHandlers.generate_po_number = () => "PO-AI-1"
  db.rpcHandlers.generate_quotation_number = () => "QT-AI-1"
  useDb(db)
  return db
}
const ceo = { seesProfit: true }

test("C1. the summary counts what is still unpaid (balance), not the full invoice", async () => {
  const s = await businessSummary(seed())
  assert.match(s, /Customers still owe: 2000 on 1 invoices; overdue 2000/)
  assert.match(s, /Cash balance \(latest entry\): 12345/)
  assert.doesNotMatch(s, /water pump/i)
})

test("C2. lookups: Arabic letter variants match; an order overview; balances; stock (cost only for CEO/admin)", async () => {
  const db = seed()
  assert.equal(matches("مصطفي", "مصطفى"), true)
  assert.deepEqual((await runTool(db, "find_sales_orders", { query: "bostanji" }, ceo)).result, [
    { so_number: "SO-2026-507661", customer: "Bostanji ", status: "accountant_approved", delivery: "PARTIALLY_DELIVERED", total: 10000, created: "2026-11-01" },
  ])
  const ov: any = (await runTool(db, "order_overview", { so_number: "507661" }, ceo)).result
  assert.equal(ov.so.number, "SO-2026-507661")
  assert.deepEqual(ov.still_to_do[0], { kind: "no_po", name: "تزجه", quantity: 5 })
  assert.ok(ov.profit)
  const bal: any = (await runTool(db, "customer_balance", { name: "bostanji" }, ceo)).result
  assert.deepEqual([bal[0].still_owed, bal[0].open_invoices.length], [2000, 1])
  const stock: any = (await runTool(db, "stock_lookup", { product: "drill" }, { seesProfit: false })).result
  assert.deepEqual(stock[0].on_hand, [{ warehouse: "Main", quantity: 4, reorder_point: 5 }])
  assert.equal(stock[0].last_landed_cost, undefined)
  assert.match(JSON.stringify((await runTool(db, "order_overview", { so_number: "nope" }, ceo)).result), /No sales order/)
})

test("C3. proposals only build a card (nothing written); a PO line is linked to the sales-order line by name", async () => {
  const db = seed()
  const before = JSON.stringify(db.tables)
  const po = await runTool(db, "propose_purchase_order", { supplier: "مصطفى", so_number: "SO-2026-507661", lines: [{ item: "تزجة", quantity: 5 }] }, ceo)
  assert.deepEqual(po.proposal, {
    kind: "purchase_order",
    title: "New purchase order to مصطفي ",
    supplierId: 9,
    supplier: "مصطفي ",
    soNumber: "SO-2026-507661",
    lines: [{ name: "تزجه", quantity: 5, unitCost: 1500, sourceSoId: 4, sourceSoItemId: 60 }],
    total: 7500,
  })
  const q = await runTool(db, "propose_quotation", { customer: "افاتار", lines: [{ product: "drill", quantity: 2 }, { product: "Gear pump", quantity: 1, unit_price: 800 }] }, ceo)
  assert.equal((q.proposal as any).customerId, 6)
  assert.deepEqual((q.proposal as any).lines, [
    { productId: 7, name: "Drill 20V", quantity: 2, unitPrice: 1500, itemType: "inventory" },
    { productId: null, name: "Gear pump", quantity: 1, unitPrice: 800, itemType: "outsourced" },
  ])
  const unclear = await runTool(db, "propose_purchase_order", { supplier: "nobody", lines: [{ item: "x", quantity: 1 }] }, ceo)
  assert.equal(unclear.proposal, undefined)
  assert.equal(JSON.stringify(db.tables), before)
})

// a stand-in for Google: each call returns the next prepared answer
function fakeGemini(answers: any[]) {
  const sent: any[] = []
  const real = globalThis.fetch
  globalThis.fetch = (async (_url: any, init: any) => {
    sent.push(JSON.parse(init.body))
    return new Response(JSON.stringify(answers.shift()), { status: 200, headers: { "content-type": "application/json" } })
  }) as any
  return { sent, restore: () => (globalThis.fetch = real) }
}
const say = (text: string) => ({ candidates: [{ content: { role: "model", parts: [{ text }] } }] })
const ask = (name: string, args: any) => ({ candidates: [{ content: { role: "model", parts: [{ functionCall: { name, args } }] } }] })

test("C4. the chat looks things up step by step and answers from them; a proposal comes back as a card line", async () => {
  process.env.GEMINI_API_KEY = "test-key"
  const db = seed()
  const g = fakeGemini([ask("customer_balance", { name: "bostanji" }), say("Bostanji still owes 2,000 EGP."), ask("propose_note", { target: "so", number: "SO-2026-507661", text: "Call about the 5 تزجه" }), say("I prepared a note; please confirm.")])
  try {
    const r = await chatRoute.POST(new Request("http://test.local/api/ai/ceo-chat", { method: "POST", headers: { "x-mm-roles": "ceo" }, body: JSON.stringify({ messages: [{ role: "user", content: "How much does Bostanji owe?" }] }) }))
    const body = await r.text()
    assert.match(body, /^0:"Bostanji still owes 2,000 EGP\."/)
    // the lookup result went back to the model
    assert.match(JSON.stringify(g.sent[1].contents.at(-1)), /"still_owed":2000/)
    assert.match(g.sent[0].systemInstruction.parts[0].text, /Customers still owe: 2000/)
    const r2 = await chatRoute.POST(new Request("http://test.local/api/ai/ceo-chat", { method: "POST", body: JSON.stringify({ messages: [{ role: "user", content: "add a note" }] }) }))
    const lines = (await r2.text()).split("\n")
    const card = JSON.parse(lines.find((l) => l.startsWith("p:"))!.slice(2))
    assert.deepEqual([card.kind, card.id, card.text], ["note", 4, "Call about the 5 تزجه"])
    assert.equal(db.tables.workflow_events.length, 0) // nothing saved before Confirm
  } finally {
    g.restore()
  }
})

test("C5. Confirm saves through the normal routes: note, linked pending PO (marked 'from the CEO chat'), quotation; a bad card is refused", async () => {
  const db = seed()
  const confirm = (proposal: any) => call(confirmRoute.POST as any, "POST", { proposal })
  const note = await confirm({ kind: "note", title: "x", target: "so", id: 4, number: "SO-2026-507661", text: "Call them" })
  assert.equal(note.status, 200, JSON.stringify(note.body))
  assert.equal(db.tables.workflow_events.at(-1)!.notes, "Call them")

  const po = await confirm({ kind: "purchase_order", title: "x", supplierId: 9, supplier: "مصطفي", soNumber: "SO-2026-507661", total: 7500, lines: [{ name: "تزجه", quantity: 5, unitCost: 1500, sourceSoId: 4, sourceSoItemId: 60 }] })
  assert.equal(po.status, 200, JSON.stringify(po.body))
  const created = db.tables.purchase_orders.at(-1)!
  assert.deepEqual([created.po_number, created.status, created.supplier_id], ["PO-AI-1", "pending", 9])
  const line = db.tables.purchase_order_items.at(-1)!
  assert.deepEqual([line.item_type, line.outsourced_name, line.source_so_item_id, line.quantity, line.unit_price], ["outsourced", "تزجه", 60, 5, 1500])
  assert.ok(db.tables.workflow_events.some((e) => e.entity_type === "PURCHASE_ORDER" && e.entity_id === created.po_id && e.notes === "Created from the CEO chat"))

  const q = await confirm({ kind: "quotation", title: "x", customerId: 6, customer: "افاتار", notes: "", total: 3000, lines: [{ productId: 7, name: "Drill 20V", quantity: 2, unitPrice: 1500, itemType: "inventory" }] })
  assert.equal(q.status, 200, JSON.stringify(q.body))
  assert.equal(db.tables.sales_quotations.at(-1)!.quotation_number, "QT-AI-1")

  for (const bad of [{ kind: "note", target: "so", id: 0, text: "x" }, { kind: "purchase_order", supplierId: 9, lines: [{ name: "x", quantity: -1, unitCost: 1 }] }, { kind: "delete_everything" }]) {
    assert.equal((await confirm(bad)).status, 400)
  }
})
