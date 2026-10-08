import { type NextRequest, NextResponse } from "next/server"
import { createAdminClient } from "@/lib/supabase/admin"
import { lineKey, loadReturnLines, returnedByKey } from "@/lib/return-lines"
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

    // returned quantity per line (Batch 2 helpers); handed out to lines of the same product in order, capped at the line quantity
    const permits = must(await db.from("delivery_permits").select("permit_id").eq("sales_order_id", soId), "load delivery permits") as any[]
    const returnedLeft = returnedByKey(await loadReturnLines(db, permits.map((p) => p.permit_id)))
    const items = soItems.map((i) => {
      const key = lineKey(i.product_id, i.outsourced_name)
      const qty = Number(i.quantity) || 0
      const take = Math.min(returnedLeft.get(key) || 0, qty)
      returnedLeft.set(key, (returnedLeft.get(key) || 0) - take)
      return {
        name: i.item_type === "outsourced" ? i.outsourced_name || "-" : names.get(i.product_id) || `Product #${i.product_id}`,
        quantity: qty,
        unit_price: Number(i.unit_price) || 0,
        total: Number(i.total) || 0,
        returned: take,
      }
    })

    return new NextResponse(renderSoPrintHtml({ so, customer, items }), { headers: { "Content-Type": "text/html; charset=utf-8" } })
  } catch (error) {
    console.error("Sales order print error:", error)
    return errorPage("Failed to Generate Print", "An unexpected error occurred while generating the sales order print.", 500)
  }
}
