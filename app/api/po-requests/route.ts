import { type NextRequest, NextResponse } from "next/server"
import { createAdminClient } from "@/lib/supabase/admin"

export const dynamic = "force-dynamic"

export async function GET(request: NextRequest) {
  try {
    const supabase = createAdminClient()
    const { searchParams } = new URL(request.url)
    const status = searchParams.get("status")

    let query = supabase
      .from("po_requests")
      .select(`
        *,
        suppliers (
          supplier_id,
          supplier_name,
          email,
          phone
        ),
        po_request_items (
          item_id,
          product_id,
          product_name,
          quantity,
          unit,
          notes,
          products (
            product_id,
            product_name,
            sku,
            unit
          )
        )
      `)
      .order("created_at", { ascending: false })

    if (status) {
      query = query.eq("status", status)
    }

    const { data, error } = await query

    if (error) {
      console.error("PO Requests fetch error:", error)
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    return NextResponse.json(data)
  } catch (error) {
    console.error("PO Requests error:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  try {
    const supabase = createAdminClient()
    const body = await request.json()
    const { supplier_id, expected_delivery_date, notes, items } = body

    if (!supplier_id || !items || items.length === 0) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 })
    }

    // Generate PO Request number
    const { data: numberData, error: numberError } = await supabase.rpc("generate_po_request_number")

    if (numberError) {
      console.error("Generate PO request number error:", numberError)
      return NextResponse.json({ error: "Failed to generate request number" }, { status: 500 })
    }

    const requestNumber = numberData as string

    // Create PO Request
    const { data: poRequest, error: requestError } = await supabase
      .from("po_requests")
      .insert({
        request_number: requestNumber,
        supplier_id,
        expected_delivery_date,
        notes,
        status: "pending",
        created_by: "current_user",
      })
      .select()
      .single()

    if (requestError) {
      console.error("Create PO request error:", requestError)
      return NextResponse.json({ error: requestError.message }, { status: 500 })
    }

    // Create PO Request Items
    const itemsToInsert = items.map((item: any) => ({
      request_id: poRequest.request_id,
      product_id: item.product_id,
      product_name: item.product_name,
      quantity: item.quantity,
      unit: item.unit,
      notes: item.notes,
    }))

    const { error: itemsError } = await supabase
      .from("po_request_items")
      .insert(itemsToInsert)

    if (itemsError) {
      console.error("Create PO request items error:", itemsError)
      // Rollback the request
      await supabase.from("po_requests").delete().eq("request_id", poRequest.request_id)
      return NextResponse.json({ error: itemsError.message }, { status: 500 })
    }

    return NextResponse.json(poRequest, { status: 201 })
  } catch (error) {
    console.error("PO Request creation error:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}

export async function PUT(request: NextRequest) {
  try {
    const supabase = createAdminClient()
    const body = await request.json()
    const { request_id, status } = body

    if (!request_id || !status) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 })
    }

    const { data, error } = await supabase
      .from("po_requests")
      .update({ status, updated_at: new Date().toISOString() })
      .eq("request_id", request_id)
      .select()
      .single()

    if (error) {
      console.error("Update PO request error:", error)
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    return NextResponse.json(data)
  } catch (error) {
    console.error("PO Request update error:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
