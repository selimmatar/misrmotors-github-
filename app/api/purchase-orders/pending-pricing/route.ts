import { createAdminClient } from "@/lib/supabase/admin"
import { NextResponse } from "next/server"

export const dynamic = "force-dynamic"

export async function GET() {
  try {
    console.log("[v0] Pending Pricing Review: Starting fetch")
    const supabase = createAdminClient()

    // Also include approved POs with costs finalized (in case goods not yet received but costs known)
    const { data: pos, error: posError } = await supabase
      .from("purchase_orders")
      .select("*")
      .eq("cost_finalized", true)
      .in("status", ["received", "approved"]) // Include both statuses
      .order("cost_finalized_at", { ascending: false })

    if (posError) {
      console.error("[v0] Pending Pricing Review: Error fetching POs", posError)
      throw posError
    }

    console.log("[v0] Pending Pricing Review: Found", pos?.length || 0, "cost-finalized POs")

    // Get all items from these POs with product details
    const poIds = (pos || []).map((po) => po.po_id)

    if (poIds.length === 0) {
      console.log("[v0] Pending Pricing Review: No cost-finalized POs found")
      return NextResponse.json([])
    }

    const { data: items, error: itemsError } = await supabase
      .from("purchase_order_items")
      .select("*, products(*)")
      .in("po_id", poIds)

    if (itemsError) {
      console.error("[v0] Pending Pricing Review: Error fetching items", itemsError)
      throw itemsError
    }

    console.log("[v0] Pending Pricing Review: Found", items?.length || 0, "items across", poIds.length, "POs")

    // We want to show products where landed_cost > 0 but price hasn't been reviewed yet
    const productMap = new Map()

    for (const item of items || []) {
      const po = pos?.find((p) => p.po_id === item.po_id)
      if (!po || !item.products) continue

      const landedCostPerUnit = item.landed_cost ? item.landed_cost / item.quantity : 0
      if (landedCostPerUnit <= 0) continue

      const lastPriceUpdate = item.products.price_updated_at
      if (lastPriceUpdate && po.cost_finalized_at && new Date(lastPriceUpdate) > new Date(po.cost_finalized_at)) {
        console.log(
          "[v0] Pending Pricing: Skipping",
          item.products.product_name,
          "- price already updated after cost finalization",
        )
        continue
      }

      console.log("[v0] Pending Pricing Review: Processing item", {
        productId: item.product_id,
        productName: item.products?.product_name,
        landedCost: item.landed_cost,
        landedCostPerUnit,
        allocatedTax: item.allocated_tax,
        allocatedOverhead: item.allocated_overhead,
        poStatus: po.status,
      })

      if (!productMap.has(item.product_id)) {
        productMap.set(item.product_id, {
          productId: item.product_id,
          productName: item.products.product_name,
          sku: item.products.sku,
          currentUnitPrice: item.products.unit_price,
          currentMarkup: item.products.markup_percentage || 0,
          purchaseHistory: [],
        })
      }

      productMap.get(item.product_id).purchaseHistory.push({
        poNumber: po.po_number,
        poDate: po.order_date,
        poStatus: po.status, // Include PO status for reference
        quantity: item.quantity,
        unitPrice: item.unit_price,
        allocatedTax: item.allocated_tax || 0,
        allocatedOverhead: item.allocated_overhead || 0,
        landedCost: item.landed_cost || item.total,
        landedCostPerUnit: landedCostPerUnit,
      })
    }

    const result = Array.from(productMap.values())
    console.log("[v0] Pending Pricing Review: Found", result.length, "products for pricing review")

    return NextResponse.json(result)
  } catch (error) {
    console.error("[v0] Pending Pricing Review: Error", error)
    return NextResponse.json({ error: "Failed to fetch pending pricing review" }, { status: 500 })
  }
}
