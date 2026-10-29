// Quiet sidebar counters for the price request chain (owner request, 2026-10-29): the purchasing manager sees
// sales orders that still need a purchase order and price requests waiting for a supplier price; the sales rep sees
// price requests whose supplier price is not on the quotation yet. Plus the quotation line under each request number.
import "./route-harness"
import test from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { FakeDb } from "./fake-db"
import { call, useDb } from "./route-harness"
import { rowsNeedPo, unappliedQuotedRequests } from "../notifications/counts"
import { workflowSwitch } from "../workflow-switch"
import * as pendingCounts from "../../app/api/pending-counts/route"
import * as pendingDetails from "../../app/api/pending-counts/details/route"

const src = (p: string) => readFileSync(join(process.env.REPO_ROOT || process.cwd(), p), "utf8")
const details = async (screen: string, role: string) =>
  (await call(pendingDetails.GET, "GET", undefined, `http://test.local/api/pending-counts/details?screen=${screen}&role=${role}`)).body
const counts = async (role: string) => (await call(pendingCounts.GET, "GET", undefined, `http://test.local/api/pending-counts?role=${role}`)).body

test("a sales order needs a PO while any line says Needs PO or Needs Reorder", () => {
  assert.equal(rowsNeedPo([{ procurementStatus: "Not Ordered — Needs PO" }]), true)
  assert.equal(rowsNeedPo([{ procurementStatus: "In stock 2/5 — Needs PO for 3" }]), true)
  assert.equal(rowsNeedPo([{ procurementStatus: "Rejected PO — Needs Reorder (PO-1)" }]), true)
  assert.equal(rowsNeedPo([{ procurementStatus: "In Stock" }, { procurementStatus: "PO Approved (PO-2)" }]), false)
  assert.equal(rowsNeedPo([]), false)
})

test("a quoted price request counts until one of its prices is on its open quotation", () => {
  const requests = [
    { request_id: 1, sales_quotation_id: 10, po_request_items: [{ product_name: "Pump  A", unit_price: 1250 }] },
    { request_id: 2, sales_quotation_id: 10, po_request_items: [{ product_name: "Valve", unit_price: 300 }] },
    { request_id: 3, sales_quotation_id: 20, po_request_items: [{ product_name: "Pump A", unit_price: 1250 }] },
    { request_id: 4, sales_quotation_id: null, po_request_items: [] },
  ]
  const lines = [
    { quotation_id: 10, product_name: "pump a", unit_cost: "1250.00", item_type: "outsourced" },
    { quotation_id: 10, product_name: "Valve", unit_cost: 280, item_type: "outsourced" },
    { quotation_id: 20, product_name: "Pump A", unit_cost: 1250, item_type: "inventory" },
  ]
  // 1 applied (same name, same cost); 2 a different cost; 3 only a stock line matches; 4 no quotation
  assert.equal(unappliedQuotedRequests(requests, new Set([10, 20]), lines), 2)
  // quotation 20 converted or closed: its request stops counting
  assert.equal(unappliedQuotedRequests(requests, new Set([10]), lines), 1)
})

function chainDb() {
  return new FakeDb({
    purchase_orders: [],
    purchase_order_items: [],
    goods_receipt_lines: [],
    sales_orders: [
      { so_id: 1, so_number: "SO-1", status: "accountant_approved", parent_quotation_id: 30, customer_id: 5 },
      { so_id: 2, so_number: "SO-2", status: "accountant_approved", parent_quotation_id: null, customer_id: 5 },
      { so_id: 3, so_number: "SO-3", status: "delivered", parent_quotation_id: 31, customer_id: 5 },
    ],
    customers: [{ customer_id: 5, customer_name: "Ahmed Trading" }],
    sales_order_items: [
      { so_item_id: 11, so_id: 1, product_id: null, quantity: 2, unit_price: 100, item_type: "outsourced", outsourced_name: "Pump A" },
      { so_item_id: 21, so_id: 2, product_id: null, quantity: 2, unit_price: 100, item_type: "outsourced", outsourced_name: "Pump B" },
      { so_item_id: 31, so_id: 3, product_id: null, quantity: 2, unit_price: 100, item_type: "outsourced", outsourced_name: "Pump C" },
    ],
    products: [], inventory: [], delivery_permits: [], delivery_permit_items: [],
    returns: [], return_items: [], sales_returns: [], sales_return_items: [],
    po_requests: [
      { request_id: 1, request_number: "POR-1", status: "pending", sales_quotation_id: 40, supplier_id: 9 },
      { request_id: 2, request_number: "POR-2", status: "quoted", sales_quotation_id: 40 },
      { request_id: 3, request_number: "POR-3", status: "quoted", sales_quotation_id: 40 },
      { request_id: 4, request_number: "POR-4", status: "cancelled", sales_quotation_id: 40 },
    ],
    po_request_items: [
      { item_id: 1, request_id: 2, product_name: "Pump A", unit_price: 500 },
      { item_id: 2, request_id: 3, product_name: "Valve", unit_price: 90 },
    ],
    sales_quotations: [{ id: 40, quotation_number: "QT-2026-031", customer_name: "Ahmed Trading", status: "sent" }],
    sales_quotation_items: [{ id: 1, quotation_id: 40, product_name: "Pump A", unit_cost: 500, item_type: "outsourced" }],
    maintenance_work_orders: [],
    suppliers: [{ supplier_id: 9, supplier_name: "Cairo Parts" }],
  })
}

test("purchasing manager: SOs from a quotation that still need a PO, and price requests waiting for a price", async () => {
  const db = chainDb()
  useDb(db)
  for (const role of ["po-rep", "ceo"]) {
    const body = await counts(role)
    assert.equal(body["purchase-orders"], 1, `${role}: only SO-1 (from a quotation, open, nothing ordered)`)
    assert.equal(body["po-requests"], 1, `${role}: one pending request`)
  }
  // a PO now covers SO-1's line: the count goes down
  db.tables.purchase_orders.push({ po_id: 7, po_number: "PO-7", status: "pending" })
  db.tables.purchase_order_items.push({ po_item_id: 70, po_id: 7, source_so_item_id: 11, quantity: 2, unit_price: 50 })
  // the pending PO itself still counts as waiting for approval, SO-1 no longer does
  assert.equal((await counts("po-rep"))["purchase-orders"], 1)
  db.tables.purchase_orders[0].status = "approved"
  assert.equal((await counts("po-rep"))["purchase-orders"], 0)
  // the request gets its price: the pending count goes down
  db.tables.po_requests[0].status = "quoted"
  assert.equal((await counts("po-rep"))["po-requests"], 0)
  assert.equal((await counts("sales-rep"))["po-requests"], undefined)
})

test("sales rep: a received price counts until it is applied to the quotation or the quotation is converted", async () => {
  const db = chainDb()
  useDb(db)
  // POR-2's price is on the quotation already; POR-3's is not
  assert.equal((await counts("sales-rep"))["sales-orders"], 1)
  assert.equal((await counts("po-rep"))["sales-orders"], undefined)
  db.tables.sales_quotation_items.push({ id: 2, quotation_id: 40, product_name: "valve", unit_cost: 90, item_type: "outsourced" })
  assert.equal((await counts("sales-rep"))["sales-orders"], 0)
  db.tables.sales_quotation_items.pop()
  db.tables.sales_orders.push({ so_id: 4, so_number: "SO-4", status: "pending_accountant", parent_quotation_id: 40, customer_id: 5 })
  assert.equal((await counts("sales-rep"))["sales-orders"], 0, "converted quotation")
})

test("waiting for you: each screen's list holds exactly the items behind its counter", async (t) => {
  const db = chainDb()
  useDb(db)
  workflowSwitch.maintenanceLive = true
  t.after(() => { workflowSwitch.maintenanceLive = false })
  db.tables.purchase_orders.push({ po_id: 8, po_number: "PO-8", status: "pending", supplier_id: 9, total: 1500, currency: "EGP" })
  db.tables.maintenance_work_orders.push(
    { work_order_id: 5, work_order_number: "WO-5", customer_name: "Nile Co", status: "on_hold" },
    { work_order_id: 6, work_order_number: "WO-6", customer_name: "Nile Co", status: "completed" },
  )
  const po = await details("purchase-orders", "po-rep")
  assert.deepEqual(po.orders, [{ so_id: 1, so_number: "SO-1", customer_name: "Ahmed Trading", items: ["Pump A"] }])
  assert.deepEqual(po.purchaseOrders, [{ po_id: 8, po_number: "PO-8", supplier_name: "Cairo Parts", total: 1500, currency: "EGP" }])
  const pr = await details("po-requests", "po-rep")
  assert.deepEqual(pr.requests, [
    { request_id: 1, request_number: "POR-1", quotation_number: "QT-2026-031", customer_name: "Ahmed Trading", supplier_name: "Cairo Parts" },
  ])
  const sales = await details("sales-orders", "sales-rep")
  assert.deepEqual(sales.prices, [
    { request_id: 3, request_number: "POR-3", quotation_id: 40, quotation_number: "QT-2026-031", customer_name: "Ahmed Trading", items: [{ name: "Valve", price: 90 }] },
  ])
  assert.deepEqual(sales.reports, [{ work_order_id: 5, work_order_number: "WO-5", customer_name: "Nile Co" }])
  // the counters are the same lists counted
  const c = await counts("ceo")
  assert.equal(c["purchase-orders"], po.orders.length + po.purchaseOrders.length)
  assert.equal(c["po-requests"], pr.requests.length)
  assert.equal(c["sales-orders"], sales.prices.length + sales.reports.length)
  // a role that does not own a screen gets nothing for it
  assert.deepEqual(await details("purchase-orders", "sales-rep"), {})
  assert.deepEqual(await details("sales-orders", "po-rep"), {})
})

test("maintenance switched off: its reports leave the counter and the list; its buttons and tabs are greyed out", async () => {
  assert.equal(workflowSwitch.maintenanceLive, false, "maintenance is not live yet")
  const db = chainDb()
  useDb(db)
  db.tables.maintenance_work_orders.push({ work_order_id: 5, work_order_number: "WO-5", customer_name: "Nile Co", status: "on_hold" })
  assert.deepEqual((await details("sales-orders", "sales-rep")).reports, [])
  assert.equal((await counts("sales-rep"))["sales-orders"], 1, "only the unapplied price")
  const so = src("components/modules/sales-order-module.tsx")
  assert.match(so, /disabled=\{!isMaintenanceLive\(\)\}\n\s*title=\{isMaintenanceLive\(\) \? t\("so\.manage-maintenance-for-this-order"\) : t\("maintenance\.not-live"\)\}/)
  assert.match(so, /<TabsTrigger value="maintenance"[^>]*disabled=\{!isMaintenanceLive\(\)\}>/)
  assert.match(so, /<TabsTrigger value="approvals"[^>]*disabled=\{!isMaintenanceLive\(\)\}>/)
  assert.match(so, /<Tabs defaultValue=\{isMaintenanceLive\(\) \? "maintenance" : "details"\}/)
  assert.match(src("components/modules/accountant-module.tsx"), /<TabsTrigger value="maintenance-invoices" className="relative" disabled=\{!isMaintenanceLive\(\)\}>/)
  assert.match(src("components/modules/shipping-module.tsx"), /<TabsTrigger value="maintenance" disabled=\{!isMaintenanceLive\(\)\}>/)
  assert.match(src("components/modules/sales-quotation-module.tsx"), /<SelectItem value="MAINTENANCE" disabled=\{!isMaintenanceLive\(\)\}>/)
  assert.match(src("components/modules/sales-quotations-hub-module.tsx"), /isMaintenanceLive\(\) && \{\n\s*key: "reports"/)
  assert.match(src("components/layout/nav-config.ts"), /id: "maintenance-invoices",[^}]*disabled: true/)
})

test("waiting for you: the button sits on the three screens and opens each item", () => {
  const box = src("components/notifications/waiting-for-you.tsx")
  assert.match(box, /if \(shown\.length === 0\) return null/)
  // a small button with the count; the list opens in a pop-up, and opening an item closes it
  assert.match(box, /<DialogTrigger asChild>/)
  assert.match(box, /aria-label=\{`\$\{t\("waiting\.title"\)\} \(\$\{total\}\)`\}/)
  assert.match(box, /setOpen\(false\)\s*row\.onOpen\(\)/)
  const pr = src("components/modules/po-request-module.tsx")
  assert.match(pr, /useWaiting<[^>]*>\("po-requests", userRole\)/)
  assert.match(pr, /if \(request\) setQuoteReceivedFor\(request\)/)
  assert.match(src("components/dashboard/dashboard.tsx"), /<PORequestModule userRole=\{user\.role\} \/>/)
  const po = src("components/modules/purchase-order-module.tsx")
  assert.match(po, /useWaiting<[^>]*>\("purchase-orders", userRole\)/)
  assert.match(po, /setSoSearchTerm\(o\.so_number\)/)
  assert.match(po, /setViewDetailsOrder\(order\)/)
  const hub = src("components/modules/sales-quotations-hub-module.tsx")
  assert.match(hub, /useWaiting<[^>]*>\("sales-orders", userRole\)/)
  assert.match(hub, /setOpenQuotationId\(p\.quotation_id\)/)
  assert.match(hub, /<MaintenanceApprovalTab userRole=\{userRole\} \/>/)
  assert.match(src("components/modules/approve-sales-quotations-module.tsx"), /openApproveConvertDialog\(\{ id: openQuotationId \}/)
})

test("price request list: quotation number and customer in small grey text under the request number", () => {
  const api = src("app/api/po-requests/route.ts")
  assert.match(api, /sales_quotations \(\s*quotation_number,\s*customer_name\s*\)/)
  const ui = src("components/modules/po-request-module.tsx")
  assert.match(ui, /\[request\.sales_quotations\?\.quotation_number, request\.sales_quotations\?\.customer_name\]\.filter\(Boolean\)\.join\(" · "\)/)
  assert.match(ui, /<div className="text-xs font-normal text-muted-foreground">\{quotationLine\(request\)\}<\/div>/)
  assert.match(ui, /<span className="block text-xs text-muted-foreground">\{quotationLine\(request\)\}<\/span>/)
})

test("Excel import: stock items match by name or SKU and keep the stock price when the sheet has none", () => {
  const ui = src("components/modules/sales-quotation-module.tsx")
  const excel = ui.slice(ui.indexOf("const handleExcelUpload"), ui.indexOf("const handleItemsPhoto"))
  assert.doesNotMatch(excel, /matchedProduct\.price\b|p\.name\b|matchedProduct\.name\b/)
  assert.match(excel, /p\.productName\?\.trim\(\)\.toLowerCase\(\) === name \|\| p\.sku\?\.trim\(\)\.toLowerCase\(\) === name/)
  assert.match(excel, /product_id: Number\(matchedProduct\.id\)/)
  assert.match(excel, /unitPrice <= 0 \? matchedProduct\.unitPrice \|\| 0 : unitPrice/)
})
