import { NextResponse } from "next/server"
import { createAdminClient } from "@/lib/supabase/admin"

export async function POST(request: Request) {
  try {
    const {
      inventoryId,
      quantity,
      unitCost,
      supplierName,
      supplierNameId,
      soNumber,
      productName,
    } = await request.json()

    console.log("[v0] remove-returned API received:", {
      inventoryId,
      quantity,
      unitCost,
      supplierName,
      supplierNameId,
      soNumber,
      productName,
    })

    const supabase = createAdminClient()

    // 1. Delete the returned item from inventory
    console.log("[v0] Deleting inventory_id:", inventoryId)
    const { error: deleteError } = await supabase
      .from("inventory")
      .delete()
      .eq("inventory_id", inventoryId)
    
    console.log("[v0] Delete result:", { error: deleteError })

    if (deleteError) {
      console.error("[v0] Error deleting inventory:", deleteError)
      return NextResponse.json(
        { message: "Failed to remove item from inventory" },
        { status: 400 }
      )
    }

    // 2. Find the supplier by name to get supplier_id
    let supplierId: number | null = null

    if (supplierNameId) {
      supplierId = Number(supplierNameId)
    } else if (supplierName) {
      const { data: supplier, error: supplierError } = await supabase
        .from("suppliers")
        .select("supplier_id")
        .ilike("supplier_name", supplierName)
        .single()

      if (!supplierError && supplier) {
        supplierId = supplier.supplier_id
      }
    }

    // 3. Create a supplier credit entry
    console.log("[v0] Supplier lookup result - supplierId:", supplierId)
    if (supplierId) {
      const creditAmount = (quantity || 0) * (unitCost || 0)
      console.log("[v0] Creating supplier credit:", {
        supplierId,
        creditAmount,
        productName,
        quantity,
        unitCost,
      })

      const { error: creditError, data: creditData } = await supabase
        .from("supplier_credits")
        .insert({
          supplier_id: supplierId,
          amount: creditAmount,
          credit_type: "return",
          reference_type: "inventory",
          description: `Return of ${productName || "item"} (Qty: ${quantity})${soNumber ? ` from ${soNumber}` : ""}`,
          status: "active",
          created_at: new Date().toISOString(),
        })
        .select()

      console.log("[v0] Credit creation result:", { error: creditError, data: creditData })
      
      if (creditError) {
        console.error("[v0] Error creating supplier credit:", creditError)
        return NextResponse.json(
          { message: "Item removed but failed to create supplier credit: " + creditError.message },
          { status: 400 }
        )
      }
    } else {
      console.warn("[v0] No supplier found, skipping credit creation")
    }

    return NextResponse.json(
      { message: "Returned item removed successfully", supplierId },
      { status: 200 }
    )
  } catch (error) {
    console.error("[v0] Error in remove-returned endpoint:", error)
    return NextResponse.json(
      { message: "Internal server error" },
      { status: 500 }
    )
  }
}
