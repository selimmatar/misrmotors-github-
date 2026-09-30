import { createServerClient } from "@/lib/supabase/server"
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
export async function PATCH(request: NextRequest) {
  try {
    const supabase = await createServerClient()
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
      .eq("id", quotation_id)

    if (updateError) {
      console.error("Update quotation error:", updateError)
      return NextResponse.json({ error: "Failed to save quotation changes" }, { status: 500 })
    }

    const { error: deleteItemsError } = await supabase
      .from("sales_quotation_items")
      .delete()
      .eq("quotation_id", quotation_id)

    if (deleteItemsError) {
      console.error("Delete quotation items error:", deleteItemsError)
      return NextResponse.json({ error: "Failed to save quotation items" }, { status: 500 })
    }

    const itemsData = items.map((item: any, index: number) => ({
      quotation_id: Number(quotation_id),
      line_no: index + 1,
      item_type: item.item_type || "inventory",
      product_id: item.product_id ? Number(item.product_id) : null,
      product_name: item.product_name,
      quantity: item.quantity,
      unit_price: item.unit_price,
      total: item.quantity * item.unit_price,
      supplier_name: item.supplier_name || null,
    }))

    const { error: insertItemsError } = await supabase.from("sales_quotation_items").insert(itemsData)

    if (insertItemsError) {
      console.error("Insert quotation items error:", insertItemsError)
      return NextResponse.json({ error: "Failed to save quotation items" }, { status: 500 })
    }

    return NextResponse.json({ success: true })
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

      return NextResponse.json({ quotation })
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

    return NextResponse.json({ quotations })
  } catch (error) {
    console.error("Sales quotation GET error:", error)
    return NextResponse.json({ error: "Failed to fetch sales quotations" }, { status: 500 })
  }
}
