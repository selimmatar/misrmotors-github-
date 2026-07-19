import { createClient } from "@/lib/supabase/server"
import { NextRequest, NextResponse } from "next/server"

export const dynamic = "force-dynamic"

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const supabase = await createClient()
    const { id: supplierId } = await params

    // Fetch supplier products with product details
    const { data: supplierProducts, error } = await supabase
      .from("supplier_products")
      .select(`
        *,
        products:product_id (
          product_id,
          product_name,
          sku,
          unit,
          unit_price,
          moq,
          is_active
        )
      `)
      .eq("supplier_id", supplierId)
      .eq("is_active", true)
      .order("product_id", { ascending: true })

    if (error) {
      console.error("Error fetching supplier products:", error)
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    // Transform response to camelCase
    const formatted = supplierProducts?.map((sp: any) => ({
      id: sp.id,
      supplierId: sp.supplier_id,
      productId: sp.product_id,
      productName: sp.products?.product_name || "Unknown Product",
      sku: sp.products?.sku || "",
      unit: sp.products?.unit || "pcs",
      supplierSku: sp.supplier_sku || "",
      unitCost: sp.unit_cost || sp.products?.unit_price || 0,
      defaultPrice: sp.default_price,
      leadTimeDays: sp.lead_time_days || 7,
      isActive: sp.is_active !== false,
      notes: sp.notes || "",
      timesOrdered: sp.times_ordered || 0,
      lastOrderDate: sp.last_order_date,
      productActive: sp.products?.is_active !== false,
      moq: sp.products?.moq || 1,
    })) || []

    return NextResponse.json({ supplierProducts: formatted })
  } catch (error: any) {
    console.error("Supplier products API error:", error)
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    )
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const supabase = await createClient()
    const { id: supplierId } = await params
    const body = await request.json()

    const {
      productId,
      supplierSku,
      unitCost,
      leadTimeDays,
      notes,
    } = body

    // Validate required fields
    if (!productId) {
      return NextResponse.json(
        { error: "Product ID is required" },
        { status: 400 }
      )
    }

    // Insert new supplier-product relationship
    const { data, error } = await supabase
      .from("supplier_products")
      .insert({
        supplier_id: supplierId,
        product_id: productId,
        supplier_sku: supplierSku || null,
        unit_cost: unitCost || null,
        lead_time_days: leadTimeDays || 7,
        notes: notes || null,
        is_active: true,
        times_ordered: 0,
      })
      .select()
      .single()

    if (error) {
      // Handle unique constraint violation
      if (error.code === "23505") {
        return NextResponse.json(
          { error: "This product is already linked to this supplier" },
          { status: 409 }
        )
      }
      console.error("Error adding supplier product:", error)
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    return NextResponse.json({ supplierProduct: data }, { status: 201 })
  } catch (error: any) {
    console.error("Supplier product POST error:", error)
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    )
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const supabase = await createClient()
    const { id: supplierId } = await params
    const { searchParams } = new URL(request.url)
    const productId = searchParams.get("productId")

    if (!productId) {
      return NextResponse.json(
        { error: "Product ID is required" },
        { status: 400 }
      )
    }

    // Soft delete: set is_active to false
    const { error } = await supabase
      .from("supplier_products")
      .update({ is_active: false })
      .eq("supplier_id", supplierId)
      .eq("product_id", productId)

    if (error) {
      console.error("Error removing supplier product:", error)
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    return NextResponse.json({ message: "Product relationship removed" })
  } catch (error: any) {
    console.error("Supplier product DELETE error:", error)
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    )
  }
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const supabase = await createClient()
    const { id: supplierId } = await params
    const body = await request.json()

    const {
      productId,
      supplierSku,
      unitCost,
      leadTimeDays,
      notes,
      isActive,
    } = body

    if (!productId) {
      return NextResponse.json(
        { error: "Product ID is required" },
        { status: 400 }
      )
    }

    // Update supplier-product relationship
    const updateData: any = {}
    if (supplierSku !== undefined) updateData.supplier_sku = supplierSku
    if (unitCost !== undefined) updateData.unit_cost = unitCost
    if (leadTimeDays !== undefined) updateData.lead_time_days = leadTimeDays
    if (notes !== undefined) updateData.notes = notes
    if (isActive !== undefined) updateData.is_active = isActive

    const { data, error } = await supabase
      .from("supplier_products")
      .update(updateData)
      .eq("supplier_id", supplierId)
      .eq("product_id", productId)
      .select()
      .single()

    if (error) {
      console.error("Error updating supplier product:", error)
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    return NextResponse.json({ supplierProduct: data })
  } catch (error: any) {
    console.error("Supplier product PUT error:", error)
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    )
  }
}
