import { type NextRequest, NextResponse } from "next/server"
import { createAdminClient } from "@/lib/supabase/admin"
import { lineKey, loadReturnLines, returnedByKey } from "@/lib/return-lines"
import { lineDeliveryStates } from "@/lib/delivery-status"
import { renderSoPrintHtml } from "@/lib/so-print-html"
import { escapeHtml } from "@/lib/print-html"

export const dynamic = "force-dynamic"

function errorPage(title: string, message: string, status: number) {
  return new NextResponse(
    `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>${escapeHtml(title)}</title></head>
    <body style="font-family: Arial, sans-serif; padding: 60px; text-align: center; color: #333;">
      <h2 style="color: #dc2626;">${escapeHtml(title)}</h2><p>${escapeHtml(message)}</p>
    </body></html>`,
    { status, headers: { "Content-Type": "text/html; charset=utf-8" } },
  )
}

const must = (result: any, what: string) => {
  if (result.error) throw new Error(`${what}: ${result.error.message}`)
  return result.data
}

// GET ?soId=<positive integer>   Read-only: prints the CURRENT saved state of any sales order (every status).
export async function GET(request: NextRequest) {
  try {
    const soIdParam = new URL(request.url).searchParams.get("soId")
    if (!soIdParam || !/^\d{1,9}$/.test(soIdParam) || Number(soIdParam) < 1) {
      return errorPage("Missing Sales Order ID", "Please provide a valid sales order ID (soId).", 400)
    }
    const soId = Number(soIdParam)
    const db = createAdminClient()

    const so = must(await db.from("sales_orders").select("*").eq("so_id", soId).maybeSingle(), "load sales order")
    if (!so) return errorPage("Sales Order Not Found", `No sales order found for ID ${soId}.`, 404)

    const customer = so.customer_id
      ? must(await db.from("customers").select("customer_name, phone, email").eq("customer_id", so.customer_id).maybeSingle(), "load customer")
      : null

    const soItems = must(
      await db.from("sales_order_items").select("so_item_id, product_id, quantity, unit_price, total, item_type, outsourced_name").eq("so_id", soId).order("so_item_id", { ascending: true }),
      "load sales order items",
    ) as any[]

    const productIds = [...new Set(soItems.filter((i) => i.product_id).map((i) => i.product_id as number))]
    const names = new Map<number, string>()
    if (productIds.length > 0) {
      for (const p of must(await db.from("products").select("product_id, product_name").in("product_id", productIds), "load products") as any[]) names.set(p.product_id, p.product_name)
    }

    // "Returned" is printed only on a line kept at quantity 0 on purpose: the person chose "keep it on the order as
    // returned" when deleting it. A line still on the order (same or new name / price) is the replacement the customer
    // will get, so it is printed as a normal line (owner request, 2026-11-11). A deleted line is not printed at all.
    const permits = must(
      await db.from("delivery_permits").select("permit_id, permit_no, status, submitted_signed_at, created_at").eq("sales_order_id", soId),
      "load delivery permits",
    ) as any[]
    const returnLines = await loadReturnLines(db, permits.map((p) => p.permit_id))
    const returnedLeft = returnedByKey(returnLines)
    const items = soItems.map((i) => {
      const key = lineKey(i.product_id, i.outsourced_name)
      const qty = Number(i.quantity) || 0
      const take = qty === 0 ? returnedLeft.get(key) || 0 : 0
      if (take > 0) returnedLeft.set(key, 0)
      return {
        name: i.item_type === "outsourced" ? i.outsourced_name || "-" : names.get(i.product_id) || `Product #${i.product_id}`,
        quantity: qty,
        unit_price: Number(i.unit_price) || 0,
        total: Number(i.total) || 0,
        returned: take,
      }
    })

    // ?delivery=status | delivered (owner request, 2026-11-12): delivered = on signed / approved permits, less returns.
    const mode = new URL(request.url).searchParams.get("delivery")
    let delivery: { mode: "status" | "delivered"; permits: { number: string; date: string | null; status: string }[] } | undefined
    if (mode === "status" || mode === "delivered") {
      const signed = permits.filter((p) => ["SUBMITTED_SIGNED", "DELIVERED", "APPROVED"].includes(p.status))
      const confirmed = new Map<string, number>()
      if (signed.length > 0) {
        const dpItems = must(
          await db.from("delivery_permit_items").select("permit_id, product_id, item_name_snapshot, quantity").in("permit_id", signed.map((p) => p.permit_id)),
          "load delivery permit items",
        ) as any[]
        for (const it of dpItems) {
          const key = lineKey(it.product_id, it.item_name_snapshot)
          confirmed.set(key, (confirmed.get(key) || 0) + (Number(it.quantity) || 0))
        }
        for (const p of signed) {
          for (const [key, qty] of returnedByKey(returnLines, { permitId: p.permit_id })) confirmed.set(key, (confirmed.get(key) || 0) - qty)
        }
      }
      const states = lineDeliveryStates(soItems.map((i) => ({ key: lineKey(i.product_id, i.outsourced_name), quantity: Number(i.quantity) || 0 })), confirmed)
      items.forEach((item: any, idx: number) => (item.delivered = states[idx].deliveredQuantity))
      delivery = {
        mode,
        permits: permits
          .filter((p) => p.status !== "REJECTED")
          .sort((a, b) => String(a.created_at || "").localeCompare(String(b.created_at || "")))
          .map((p) => ({ number: p.permit_no || `#${p.permit_id}`, date: p.submitted_signed_at || p.created_at || null, status: p.status })),
      }
    }

    return new NextResponse(renderSoPrintHtml({ so, customer, items, delivery }), { headers: { "Content-Type": "text/html; charset=utf-8" } })
  } catch (error) {
    console.error("Sales order print error:", error)
    return errorPage("Failed to Generate Print", "An unexpected error occurred while generating the sales order print.", 500)
  }
}
