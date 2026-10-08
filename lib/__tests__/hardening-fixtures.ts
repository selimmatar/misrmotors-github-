// Fixtures for the hardening tests: render every HTML print route from canned data. Used twice with identical data:
// once against the code as it was BEFORE the escaping change (to record the golden HTML in fixtures/hardening/) and
// once by hardening.test.ts (which compares today's output with the golden files byte for byte, and then renders the
// same documents with hostile strings). Only imports modules that exist before and after the change.
import "./route-harness"
import { useDb } from "./route-harness"
import * as dpPdf from "../../app/api/delivery-permits/pdf/route"
import * as poReqPdf from "../../app/api/po-requests/pdf/route"
import * as poPdf from "../../app/api/purchase-orders/pdf/route"
import * as apPdf from "../../app/api/invoices/ap/[id]/pdf/route"
import * as arPdf from "../../app/api/invoices/ar/[id]/pdf/route"
import * as apPdf2 from "../../app/api/invoices/ap/[id]/[invoiceId]/pdf/route"
import * as arPdf2 from "../../app/api/invoices/ar/[id]/[invoiceId]/pdf/route"
import * as quotationGen from "../../app/api/quotations/generate/route"
import * as workOrderPdf from "../../app/api/maintenance/work-orders/[id]/pdf/route"

type Rows = Record<string, any[]>

/** Chainable stand-in for the Supabase client: every filter returns itself, awaiting yields the table's canned rows. */
export function cannedDb(tables: Rows): any {
  const chain = (table: string): any => {
    let single = false
    const proxy: any = new Proxy(
      {},
      {
        get(_t, prop) {
          if (prop === "then") {
            return (resolve: (v: any) => void) => {
              const rows = tables[table] ?? []
              if (single) resolve(rows.length ? { data: rows[0], error: null } : { data: null, error: { message: "not found" } })
              else resolve({ data: rows, error: null })
            }
          }
          if (prop === "single" || prop === "maybeSingle") return () => ((single = true), proxy)
          return () => proxy
        },
      },
    )
    return proxy
  }
  return { from: (table: string) => chain(table) }
}

export function nreq(url: string): any {
  return Object.assign(new Request(url), { nextUrl: new URL(url) })
}

/** `t(label)` gives the text for one DB/user-provided field; the hostile variant appends markup to it. */
export type Text = (label: string) => string

export const HOSTILE = `<b id="PWN">&'"</b>`
export const ordinary: Text = (label) => label
export const hostile: Text = (label) => label + HOSTILE

const render = async (res: Response) => ({ status: res.status, html: await res.text() })

export async function renderAll(t: Text): Promise<Record<string, { status: number; html: string }>> {
  const out: Record<string, { status: number; html: string }> = {}
  const realFetch = globalThis.fetch
  globalThis.fetch = (async () => new Response("", { status: 404 })) as any // the routes try to inline a logo
  try {
    // ---- delivery permit
    useDb(
      cannedDb({
        delivery_permits: [
          {
            permit_id: 1,
            permit_no: t("DP-2026-0001"),
            created_at: "2026-10-01T09:00:00Z",
            recipient_name: t("Recipient Name"),
            delivery_address: t("Delivery Address 5"),
            recipient_phone: t("Phone-DP"),
            sales_orders: { so_number: t("SO-1001"), quotation_request_number: t("QR-77") },
            customers: { customer_name: t("Customer Co"), address: "x", phone: "y" },
          },
        ],
        delivery_permit_items: [
          { item_id: 1, permit_id: 1, quantity: 3, item_name_snapshot: t("Pump A"), sku_snapshot: t("SKU-A") },
          { item_id: 2, permit_id: 1, quantity: 12, item_name_snapshot: "مضخة ب", sku_snapshot: null },
        ],
      }),
    )
    out.dp = await render(await dpPdf.GET(nreq("http://test.local/api/delivery-permits/pdf?permit_id=1")))

    // ---- PO request
    useDb(
      cannedDb({
        po_requests: [
          {
            request_id: 1,
            request_number: t("REQ-1"),
            request_date: "2026-10-02",
            created_at: "2026-10-02T00:00:00Z",
            expected_delivery_date: "2026-10-20",
            status: "pending",
            notes: t("Request notes"),
            suppliers: { supplier_name: t("Supplier One"), phone: t("Phone-0200"), email: t("s@example.com"), address: t("Supplier Street") },
            po_request_items: [
              { item_id: 1, quantity: 5, unit: t("Unit Box"), notes: t("Item note"), product_name: "x", products: { product_name: t("Filter F"), sku: t("SKU-F"), unit: "pcs" } },
              { item_id: 2, quantity: 2, unit: null, notes: null, product_name: "Loose item", products: null },
            ],
          },
        ],
      }),
    )
    out.poRequest = await render(await poReqPdf.GET(nreq("http://test.local/api/po-requests/pdf?requestId=1")))

    // ---- purchase order
    useDb(
      cannedDb({
        purchase_orders: [
          {
            po_id: 1,
            po_number: t("PO-2026-0001"),
            status: "approved",
            order_date: "2026-10-03",
            delivery_date: "2026-10-25",
            payment_type: "hybrid",
            down_payment_percent: 30,
            remaining_installment_months: 4,
            currency: t("CurX"),
            subtotal: 1000,
            tax_amount: 140,
            other_costs: 10,
            total: 1150,
            notes: t("PO notes"),
            suppliers: { supplier_name: t("Supplier Two"), phone: t("Phone-0300"), email: t("t@example.com"), address: t("Street 9"), city: t("Cairo"), country: t("Egypt") },
          },
        ],
        purchase_order_items: [
          { po_item_id: 1, po_id: 1, quantity: 4, unit_price: 250, total_price: 1000, item_name_snapshot: "snap", products: { product_name: t("Gasket G"), sku: t("SKU-G"), unit: t("Unit Set") } },
        ],
      }),
    )
    out.po = await render(await poPdf.GET(nreq("http://test.local/api/purchase-orders/pdf?poId=1")))

    // ---- AP invoice (arabic layout) and AP invoice (english layout)
    const apInvoice = {
      invoice_id: 1,
      invoice_number: t("APINV-PO-2026-0001"),
      invoice_date: "2026-10-04",
      due_date: "2026-11-03",
      status: "partially_paid",
      payment_type: "hybrid",
      amount: 1150,
      paid_amount: 300,
      down_payment_amount: 345,
      remaining_amount: 805,
      remaining_installment_months: 4,
      monthly_amount: 201.25,
      installment_months: 4,
      po_id: 1,
      payment_start_date: "2026-11-01",
      suppliers: { supplier_name: t("Supplier Three"), phone: t("Phone-0400"), address: t("AP Street"), city: t("Giza"), email: t("ap@example.com") },
      purchase_orders: {
        po_number: t("PO-2026-0001"),
        payment_type: "hybrid",
        installments: 4,
        purchase_order_items: [
          { quantity: 4, unit_price: 250, total: 1000, item_type: "stock", outsourced_name: null, item_name_snapshot: "snap", products: { product_name: t("Gasket G"), sku: t("SKU-G") } },
          { quantity: 1, unit_price: 150, total: 150, item_type: "outsourced", outsourced_name: t("Outsourced Job"), item_name_snapshot: null, products: null },
        ],
      },
    }
    useDb(cannedDb({ accounts_payable: [apInvoice] }))
    out.ap = await render(await apPdf.GET(nreq("http://test.local/x"), { params: Promise.resolve({ id: "1" }) }))
    useDb(
      cannedDb({
        accounts_payable: [apInvoice],
        purchase_order_items: [
          { quantity: 4, unit_price: 250, total: 1000, item_type: "stock", item_name_snapshot: "snap", products: { product_name: t("Gasket G"), sku: t("SKU-G") }, outsourced_description: t("Supplier: ACME") },
        ],
        company_settings: [
          { setting_key: "company_name", setting_value: t("Misr Motors Test") },
          { setting_key: "company_address", setting_value: t("1 Test Road") },
          { setting_key: "company_phone", setting_value: t("Phone-0211") },
          { setting_key: "company_email", setting_value: t("co@example.com") },
        ],
      }),
    )
    out.ap2 = await render(await apPdf2.GET(new Request("http://test.local/x"), { params: Promise.resolve({ invoiceId: "1" }) }))

    // ---- AR invoice (arabic layout, delivery-permit based) and AR invoice (english layout, order based)
    const arInvoice = {
      invoice_id: 1,
      invoice_number: t("INV-2026-0001"),
      invoice_date: "2026-10-05",
      due_date: "2026-11-04",
      created_at: "2026-10-05T08:00:00Z",
      status: "pending",
      amount: 1140,
      collected_amount: 0,
      so_id: 1,
      payment_terms: "installments",
      installment_months: 3,
      monthly_amount: 380,
      customers: { customer_name: t("Customer Co"), phone: t("Phone-0500"), address: t("AR Street"), city: t("Alex"), email: t("c@example.com"), country: t("Egypt") },
      sales_orders: {
        so_id: 1,
        so_number: t("SO-1001"),
        subtotal: 1000,
        discount_amount: 0,
        payment_type: "installments",
        installments: 3,
        quotation_request_number: t("QR-77"),
        department_name: t("Dept"),
        receiver_name: t("Receiver"),
        delivery_contact_phone: t("Phone-0111"),
        delivery_address: t("Site 4"),
        sales_order_items: [
          { product_id: 7, quantity: 2, unit_price: 500, total: 1000, item_type: "stock", outsourced_name: null, products: { product_name: t("Pump A"), sku: t("SKU-A") } },
          { product_id: null, quantity: 1, unit_price: 100, total: 100, item_type: "outsourced", outsourced_name: t("Outsourced Part"), products: null },
        ],
      },
    }
    useDb(
      cannedDb({
        accounts_receivable: [arInvoice],
        invoice_delivery_permits: [
          {
            permit_id: 1,
            delivery_permits: {
              permit_id: 1,
              permit_no: t("DP-2026-0001"),
              status: "APPROVED",
              delivery_permit_items: [{ product_id: 7, quantity: 2, unit_price: 500, total: 1000, item_name_snapshot: t("Pump A") }],
            },
          },
        ],
      }),
    )
    out.ar = await render(await arPdf.GET(nreq("http://test.local/x"), { params: Promise.resolve({ id: "1" }) }))
    useDb(
      cannedDb({
        accounts_receivable: [arInvoice],
        sales_order_items: [
          { product_id: 7, quantity: 2, unit_price: 500, total: 1000, item_type: "stock", outsourced_name: null, products: { product_name: t("Pump A"), sku: t("SKU-A") } },
          { product_id: null, quantity: 1, unit_price: 100, total: 100, item_type: "outsourced", outsourced_name: t("Outsourced Part"), products: null },
        ],
        company_settings: [{ setting_key: "company_name", setting_value: t("Misr Motors Test") }],
      }),
    )
    out.ar2 = await render(await arPdf2.GET(new Request("http://test.local/x"), { params: Promise.resolve({ invoiceId: "1" }) }))

    // ---- quotation (data comes from the query string)
    useDb(cannedDb({ products: [{ product_id: 7, product_name: "Catalog Pump", unit_price: 500 }] }))
    const data = encodeURIComponent(
      JSON.stringify({
        customer_name: t("Customer Co"),
        customer_email: t("c@example.com"),
        customer_phone: t("Phone-0100"),
        validity_days: 30,
        notes: t("Quotation notes"),
        items: [
          { product_id: 7, product_name: t("Pump A"), quantity: 2, unit_price: 500 },
          { product_id: 8, product_name: "قطعة", quantity: 3, unit_price: 99.5 },
        ],
      }),
    )
    out.quotation = await render(await quotationGen.GET(nreq(`http://test.local/api/quotations/generate?qn=${encodeURIComponent(t("QT-2026-1"))}&data=${data}`)))

    // ---- maintenance work order
    useDb(
      cannedDb({
        maintenance_work_orders: [
          {
            work_order_id: 1,
            work_order_number: t("WO-2026-0001"),
            status: "in_progress",
            category: "repair",
            created_at: "2026-10-06T10:00:00Z",
            title: t("Replace pump"),
            description: t("Pump leaking"),
            location: t("Site 9"),
            assigned_to: null,
            sales_orders: { so_number: t("SO-1001") },
            customers: { customer_name: t("Customer Co"), address: t("WO Street"), phone: t("Phone-0600") },
          },
        ],
      }),
    )
    out.workOrder = await render(await workOrderPdf.GET(nreq("http://test.local/x"), { params: Promise.resolve({ id: "1" }) }))
  } finally {
    globalThis.fetch = realFetch
  }
  return out
}

/** Dates and times that depend on "now" are masked so the golden comparison is stable. */
export function normalise(html: string): string {
  return html
    .replace(/[\d٠-٩‎‏]+\/[\d٠-٩‎‏]+\/[\d٠-٩‎‏]+(, [\d:]+)?/g, "<DATE>")
    .replace(/filename="[^"]*"/g, "")
}
