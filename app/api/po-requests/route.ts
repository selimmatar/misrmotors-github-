import { type NextRequest, NextResponse } from "next/server"
import { createAdminClient } from "@/lib/supabase/admin"
import { parsePositiveId } from "@/lib/parse-id"

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
        sales_quotations (
          quotation_number,
          customer_name
        ),
        po_request_items (
          item_id,
          product_id,
          product_name,
          quantity,
          unit,
          notes,
          unit_price,
          quotation_line_no,
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
    // The chain quotation -> PR -> SO -> PO: list the PRs of one quotation, one sales order and/or one supplier.
    for (const key of ["sales_quotation_id", "so_id", "supplier_id"] as const) {
      const raw = searchParams.get(key)
      if (raw === null) continue
      const id = parsePositiveId(raw)
      if (id === null) return NextResponse.json({ error: `Invalid ${key}` }, { status: 400 })
      query = query.eq(key, id)
    }
    const search = searchParams.get("search")?.trim()
    if (search) {
      query = query.ilike("request_number", `%${search.replace(/[%_,()]/g, "")}%`)
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
    // Optional link to the quotation the prices are asked for ("Request price from supplier").
    const salesQuotationId =
      body.sales_quotation_id === undefined || body.sales_quotation_id === null ? null : parsePositiveId(String(body.sales_quotation_id))
    if (body.sales_quotation_id != null && salesQuotationId === null) {
      return NextResponse.json({ error: "Invalid sales_quotation_id" }, { status: 400 })
    }
    let soId: number | null = null
    if (salesQuotationId !== null) {
      const { data: quotation, error: quotationError } = await supabase
        .from("sales_quotations")
        .select("id")
        .eq("id", salesQuotationId)
        .maybeSingle()
      if (quotationError) return NextResponse.json({ error: quotationError.message }, { status: 500 })
      if (!quotation) return NextResponse.json({ error: "Quotation not found" }, { status: 404 })
      // Already converted: the PR belongs to the sales order too.
      const { data: orders } = await supabase
        .from("sales_orders")
        .select("so_id")
        .eq("parent_quotation_id", salesQuotationId)
        .order("so_id", { ascending: true })
        .limit(1)
      soId = orders?.[0]?.so_id ?? null
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
        ...(salesQuotationId !== null ? { sales_quotation_id: salesQuotationId, so_id: soId } : {}),
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
      ...(salesQuotationId !== null && Number.isInteger(item.quotation_line_no) ? { quotation_line_no: item.quotation_line_no } : {}),
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

// Status change, and "Quote received": status "quoted" with the supplier's unit prices per line and the supplier's
// quotation file. A PR already turned into a PO (converted) or cancelled cannot change any more (409).
const PUT_STATUSES = ["pending", "quoted", "cancelled"]

export async function PUT(request: NextRequest) {
  try {
    const supabase = createAdminClient()
    const body = await request.json()
    const { request_id, status } = body

    if (!request_id || !status) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 })
    }
    if (!PUT_STATUSES.includes(status)) {
      return NextResponse.json({ error: `Invalid status: ${status}` }, { status: 400 })
    }
    const prices: Array<{ item_id: number; unit_price: number | null; product_name?: string }> = []
    if (body.items !== undefined) {
      if (!Array.isArray(body.items)) return NextResponse.json({ error: "items must be a list" }, { status: 400 })
      for (const item of body.items) {
        const itemId = parsePositiveId(String(item?.item_id ?? ""))
        const raw = item?.unit_price
        const price = raw === null || raw === undefined || raw === "" ? null : Number(raw)
        if (itemId === null || (price !== null && (!Number.isFinite(price) || price < 0))) {
          return NextResponse.json({ error: "Each price needs an item_id and a price of 0 or more" }, { status: 400 })
        }
        // Optional new name, e.g. "Filter – Bosch" when the brand is added on "Quote received".
        const name = typeof item?.product_name === "string" ? item.product_name.trim() : undefined
        if (item?.product_name !== undefined && (!name || name.length > 300)) {
          return NextResponse.json({ error: "An item name must be 1 to 300 characters" }, { status: 400 })
        }
        prices.push({ item_id: itemId, unit_price: price, ...(name ? { product_name: name } : {}) })
      }
    }

    const { data: existing, error: fetchError } = await supabase
      .from("po_requests")
      .select("request_id, status")
      .eq("request_id", request_id)
      .maybeSingle()
    if (fetchError) return NextResponse.json({ error: fetchError.message }, { status: 500 })
    if (!existing) return NextResponse.json({ error: "PO request not found" }, { status: 404 })
    if (existing.status === "converted" || existing.status === "cancelled") {
      return NextResponse.json({ error: `This PO request is already ${existing.status} and cannot be changed` }, { status: 409 })
    }

    for (const price of prices) {
      const { error: priceError } = await supabase
        .from("po_request_items")
        .update(price.product_name ? { unit_price: price.unit_price, product_name: price.product_name } : { unit_price: price.unit_price })
        .eq("item_id", price.item_id)
        .eq("request_id", request_id)
      if (priceError) {
        console.error("Update PO request item price error:", priceError)
        return NextResponse.json({ error: priceError.message }, { status: 500 })
      }
    }

    const update: Record<string, unknown> = { status, updated_at: new Date().toISOString() }
    if (typeof body.supplier_quote_file_url === "string" && body.supplier_quote_file_url) {
      update.supplier_quote_file_url = body.supplier_quote_file_url
    }
    const { data, error } = await supabase
      .from("po_requests")
      .update(update)
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
