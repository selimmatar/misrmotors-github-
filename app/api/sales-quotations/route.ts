import { createServerClient } from "@/lib/supabase/server"
import { createAdminClient } from "@/lib/supabase/admin"
import { getConvertedSo, getQuotationLockReason } from "@/lib/sales-quotations/converted"
import { type NextRequest, NextResponse } from "next/server"

export const dynamic = "force-dynamic"

export async function POST(request: NextRequest) {
  try {
    const supabase = await createServerClient()
    const body = await request.json()

    const { 
      customer_id,
      customer_name, 
      customer_phone, 
      customer_email, 
      quotation_request_number,
      department_name,
      receiver_name,
      delivery_date,
      delivery_address,
      delivery_contact_name,
      delivery_contact_phone,
      so_type,
      order_date,
      validity_days, 
      notes, 
      items,
      // Payment fields
      payment_type,
      payment_details,
      // Discount fields
      discount_type,
      discount_value,
      discount_amount,
      // VAT
      vat_enabled,
      tax: providedTax,
      subtotal: providedSubtotal,
      net_total,
    } = body

    if (!customer_name || !items || items.length === 0) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 })
    }

    // Generate quotation number
    const { data: numberData, error: numberError } = await supabase.rpc("generate_quotation_number")

    if (numberError) {
      console.error("Generate quotation number error:", numberError)
      return NextResponse.json({ error: "Failed to generate quotation number" }, { status: 500 })
    }

    const quotationNumber = numberData as string

    // Calculate totals - use provided values if available
    const subtotal = providedSubtotal || items.reduce((sum: number, item: any) => sum + item.quantity * item.unit_price, 0)
    const tax = providedTax !== undefined ? providedTax : subtotal * 0.14
    const total = net_total || subtotal + tax

    // Insert quotation
    const { data: quotation, error: quotationError } = await supabase
      .from("sales_quotations")
      .insert({
        quotation_number: quotationNumber,
        customer_id: customer_id || null,
        customer_name,
        customer_phone,
        customer_email,
        quotation_request_number: quotation_request_number || null,
        department_name: department_name || null,
        receiver_name: receiver_name || null,
        delivery_date: delivery_date || null,
        delivery_address: delivery_address || null,
        delivery_contact_name: delivery_contact_name || null,
        delivery_contact_phone: delivery_contact_phone || null,
        so_type: so_type || 'EQUIPMENT',
        order_date: order_date || null,
        validity_days,
        notes,
        subtotal,
        tax,
        total,
        // Payment fields
        payment_type: payment_type || 'cash',
        payment_details: payment_details || null,
        // Discount fields
        discount_type: discount_type || 'none',
        discount_value: discount_value || 0,
        discount_amount: discount_amount || 0,
        // VAT
        vat_enabled: vat_enabled !== undefined ? vat_enabled : true,
        net_total: net_total || total,
        status: "sent",
        created_by: "current_user", // TODO: Get from auth
      })
      .select()
      .single()

    if (quotationError) {
      console.error("Insert quotation error:", quotationError)
      return NextResponse.json({ error: "Failed to create quotation" }, { status: 500 })
    }

    // Insert items
    const itemsData = items.map((item: any, index: number) => ({
      quotation_id: quotation.id,
      line_no: index + 1,
      item_type: item.item_type || "inventory",
      product_id: item.product_id || null,
      product_name: item.product_name,
      quantity: item.quantity,
      unit_price: item.unit_price,
      supplier_name: item.supplier_name || null,
    }))

    const { error: itemsError } = await supabase.from("sales_quotation_items").insert(itemsData)

    if (itemsError) {
      console.error("Insert items error:", itemsError)
      return NextResponse.json({ error: "Failed to create quotation items" }, { status: 500 })
    }

    return NextResponse.json({ quotation }, { status: 201 })
  } catch (error) {
    console.error("Sales quotation POST error:", error)
    return NextResponse.json({ error: "Failed to create sales quotation" }, { status: 500 })
  }
}

// Persist edits made to an existing quotation (e.g. from the "Approve & Convert to SO"
// screen) without changing its status or converting it. Lets a sales rep save their
// adjustments — and print an up-to-date copy — before actually approving the quotation.
//
// The header and the item list are written without a database transaction, so the order
// is chosen so that a failure at any step leaves the quotation's previous items intact:
// new items are inserted first, then the header is updated, and only then are the old
// items removed. Each later failure undoes the earlier steps (compensation).
export async function PATCH(request: NextRequest) {
  try {
    const supabase = await createServerClient()
    const admin = createAdminClient()
    const body = await request.json()
    const {
      quotation_id,
      customer_id,
      customer_name,
      customer_phone,
      customer_email,
      delivery_address,
      delivery_contact_name,
      delivery_contact_phone,
      notes,
      discount_type,
      discount_value,
      discount_amount,
      subtotal,
      tax,
      total,
      net_total,
      payment_type,
      payment_details,
      items,
    } = body

    if (!quotation_id) {
      return NextResponse.json({ error: "quotation_id is required" }, { status: 400 })
    }
    if (!Array.isArray(items) || items.length === 0) {
      return NextResponse.json({ error: "At least one item is required" }, { status: 400 })
    }
    const quotationId = Number(quotation_id)

    // Load the current quotation: it must exist and must not be locked (converted,
    // rejected or expired).
    const { data: current, error: currentError } = await admin
      .from("sales_quotations")
      .select("*")
      .eq("id", quotationId)
      .single()

    if (currentError || !current) {
      return NextResponse.json({ error: "Quotation not found" }, { status: 404 })
    }

    const lockReason = await getQuotationLockReason(admin, current)
    if (lockReason) {
      return NextResponse.json({ error: lockReason }, { status: 409 })
    }

    const { data: existingItems, error: existingItemsError } = await supabase
      .from("sales_quotation_items")
      .select("id")
      .eq("quotation_id", quotationId)

    if (existingItemsError) {
      console.error("Fetch existing quotation items error:", existingItemsError)
      return NextResponse.json({ error: "Failed to save quotation items" }, { status: 500 })
    }
    const existingItemIds = (existingItems || []).map((item) => item.id)

    // Step 1: insert the new items (the old ones stay in place). `total` is a generated
    // column and must not be written.
    const itemsData = items.map((item: any, index: number) => ({
      quotation_id: quotationId,
      line_no: index + 1,
      item_type: item.item_type || "inventory",
      product_id: item.product_id ? Number(item.product_id) : null,
      product_name: item.product_name,
      quantity: item.quantity,
      unit_price: item.unit_price,
      supplier_name: item.supplier_name || null,
    }))

    const { data: insertedItems, error: insertItemsError } = await supabase
      .from("sales_quotation_items")
      .insert(itemsData)
      .select("id")

    if (insertItemsError || !insertedItems) {
      console.error("Insert quotation items error:", insertItemsError)
      return NextResponse.json({ error: "Failed to save quotation items" }, { status: 500 })
    }
    const newItemIds = insertedItems.map((item) => item.id)

    // Undo helpers for the compensation paths below.
    const removeNewItems = async () => {
      const { error } = await supabase.from("sales_quotation_items").delete().in("id", newItemIds)
      if (error) console.error("Rollback: failed to remove newly inserted quotation items:", error)
    }
    const restoreHeader = async () => {
      const { error } = await supabase
        .from("sales_quotations")
        .update({
          customer_id: current.customer_id,
          customer_name: current.customer_name,
          customer_phone: current.customer_phone,
          customer_email: current.customer_email,
          delivery_address: current.delivery_address,
          delivery_contact_name: current.delivery_contact_name,
          delivery_contact_phone: current.delivery_contact_phone,
          notes: current.notes,
          discount_type: current.discount_type,
          discount_value: current.discount_value,
          discount_amount: current.discount_amount,
          subtotal: current.subtotal,
          tax: current.tax,
          total: current.total,
          net_total: current.net_total,
          payment_type: current.payment_type,
          payment_details: current.payment_details,
          updated_at: current.updated_at,
        })
        .eq("id", quotationId)
      if (error) console.error("Rollback: failed to restore quotation header:", error)
    }

    // Step 2: update the header.
    const { error: updateError } = await supabase
      .from("sales_quotations")
      .update({
        customer_id: customer_id ? Number(customer_id) : null,
        customer_name,
        customer_phone: customer_phone || null,
        customer_email: customer_email || null,
        delivery_address: delivery_address || null,
        delivery_contact_name: delivery_contact_name || null,
        delivery_contact_phone: delivery_contact_phone || null,
        notes: notes || null,
        discount_type: discount_type || "none",
        discount_value: discount_value || 0,
        discount_amount: discount_amount || 0,
        subtotal,
        tax,
        total,
        net_total,
        payment_type: payment_type || "cash",
        payment_details: payment_details || null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", quotationId)

    if (updateError) {
      console.error("Update quotation error:", updateError)
      await removeNewItems()
      return NextResponse.json({ error: "Failed to save quotation changes" }, { status: 500 })
    }

    // Step 3: remove the previous items (by the ids captured before the insert).
    if (existingItemIds.length > 0) {
      const { error: deleteItemsError } = await supabase
        .from("sales_quotation_items")
        .delete()
        .in("id", existingItemIds)

      if (deleteItemsError) {
        console.error("Delete old quotation items error:", deleteItemsError)
        await removeNewItems()
        await restoreHeader()
        return NextResponse.json({ error: "Failed to save quotation items" }, { status: 500 })
      }
    }

    return NextResponse.json({ success: true, item_count: newItemIds.length })
  } catch (error) {
    console.error("Sales quotation PATCH error:", error)
    return NextResponse.json({ error: "Failed to save quotation changes" }, { status: 500 })
  }
}

export async function GET(request: NextRequest) {
  try {
    const supabase = await createServerClient()
    const { searchParams } = new URL(request.url)
    const id = searchParams.get("id")

    if (id) {
      // Get single quotation with items
      const { data: quotation, error: quotationError } = await supabase
        .from("sales_quotations")
        .select("*, items:sales_quotation_items(*)")
        .eq("id", id)
        .single()

      if (quotationError) {
        console.error("Fetch quotation error:", quotationError)
        return NextResponse.json({ error: "Failed to fetch quotation" }, { status: 500 })
      }

      // Additive field: the sales order this quotation was converted into (if any).
      let converted_so = null
      try {
        converted_so = await getConvertedSo(createAdminClient(), quotation.id)
      } catch (lookupError) {
        console.error("Converted SO lookup error:", lookupError)
      }

      return NextResponse.json({ quotation: { ...quotation, converted_so } })
    }

    // Get all quotations
    const { data: quotations, error } = await supabase
      .from("sales_quotations")
      .select("*")
      .order("created_at", { ascending: false })

    if (error) {
      console.error("Fetch quotations error:", error)
      return NextResponse.json({ error: "Failed to fetch quotations" }, { status: 500 })
    }

    // Additive field: the sales order each quotation was converted into (if any), earliest first.
    const convertedByQuotation = new Map<number, { so_id: number; so_number: string }>()
    try {
      const { data: childOrders, error: childError } = await createAdminClient()
        .from("sales_orders")
        .select("so_id, so_number, parent_quotation_id")
        .not("parent_quotation_id", "is", null)
        .order("so_id", { ascending: true })

      if (childError) throw childError
      for (const order of childOrders || []) {
        if (!convertedByQuotation.has(order.parent_quotation_id)) {
          convertedByQuotation.set(order.parent_quotation_id, { so_id: order.so_id, so_number: order.so_number })
        }
      }
    } catch (lookupError) {
      console.error("Converted SO lookup error:", lookupError)
    }

    return NextResponse.json({
      quotations: (quotations || []).map((q: any) => ({ ...q, converted_so: convertedByQuotation.get(q.id) || null })),
    })
  } catch (error) {
    console.error("Sales quotation GET error:", error)
    return NextResponse.json({ error: "Failed to fetch sales quotations" }, { status: 500 })
  }
}
