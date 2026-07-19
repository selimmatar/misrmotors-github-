import { createAdminClient } from "@/lib/supabase/admin"
import { NextResponse } from "next/server"

export async function POST(request: Request) {
  try {
    const supabase = createAdminClient()
    const body = await request.json()

    const { updates, userId } = body

    if (!updates || !Array.isArray(updates)) {
      return NextResponse.json({ error: "Updates array is required" }, { status: 400 })
    }

    const results = []

    for (const update of updates) {
      const { productId, lastLandedCost, markupPercentage, unitPrice } = update

      // Calculate sale price if not provided
      const calculatedPrice = unitPrice || lastLandedCost * (1 + markupPercentage / 100)

      const { data, error } = await supabase
        .from("products")
        .update({
          last_landed_cost: lastLandedCost,
          markup_percentage: markupPercentage,
          unit_price: Number(calculatedPrice.toFixed(2)),
          cost_updated_at: new Date().toISOString(),
          cost_updated_by: userId,
        })
        .eq("product_id", productId)
        .select()
        .single()

      if (error) {
        console.error("Product Pricing Update: Error updating product", productId, error)
        results.push({ productId, success: false, error: error.message })
      } else {
        results.push({ productId, success: true, data })
      }
    }

    return NextResponse.json({ results })
  } catch (error) {
    console.error("Product Pricing Update: Error", error)
    return NextResponse.json({ error: "Failed to update product pricing" }, { status: 500 })
  }
}
