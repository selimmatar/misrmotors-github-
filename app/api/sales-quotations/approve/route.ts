import { createAdminClient } from "@/lib/supabase/admin"
import { type NextRequest, NextResponse } from "next/server"

export async function POST(request: NextRequest) {
  try {
    const supabase = createAdminClient()
    const body = await request.json()
    const {
      quotation_id,
      approval_document_url,
      // Optional overrides from the sales rep editing the quotation at the "Approve &
      // Convert to SO" step (e.g. the customer only approved some of the requested
      // items). When `items` is present, every override field below is authoritative;
      // any field omitted from the payload falls back to the stored quotation value.
      items: overrideItems,
      customer_id: overrideCustomerId,
      delivery_address: overrideDeliveryAddress,
      delivery_contact_name: overrideDeliveryContactName,
      delivery_contact_phone: overrideDeliveryContactPhone,
      notes: overrideNotes,
      discount_type: overrideDiscountType,
      discount_value: overrideDiscountValue,
      discount_amount: overrideDiscountAmount,
      subtotal: overrideSubtotal,
      tax: overrideTax,
      total: overrideTotal,
      net_total: overrideNetTotal,
      payment_type: overridePaymentType,
      payment_details: overridePaymentDetails,
    } = body

    const hasEdits = Array.isArray(overrideItems)

    if (!quotation_id) {
      return NextResponse.json({ error: "Quotation ID is required" }, { status: 400 })
    }

    if (hasEdits && overrideItems.length === 0) {
      return NextResponse.json({ error: "At least one item is required to convert to a sales order" }, { status: 400 })
    }

    // Fetch the quotation from sales_quotations table
    const { data: quotation, error: quotationError } = await supabase
      .from("sales_quotations")
      .select("*, items:sales_quotation_items(*)")
      .eq("id", quotation_id)
      .single()

    if (quotationError || !quotation) {
      console.error("Fetch quotation error:", quotationError)
      return NextResponse.json({ error: "Quotation not found" }, { status: 404 })
    }

    // Check if it's in an approvable state
    if (quotation.status === "approved" || quotation.status === "rejected") {
      console.error("Quotation already processed, current status:", quotation.status)
      return NextResponse.json({ 
        error: `This quotation has already been ${quotation.status}.` 
      }, { status: 400 })
    }

    // Generate SO number
    const { data: soNumberData, error: soNumberError } = await supabase.rpc("generate_so_number")
    
    if (soNumberError) {
      console.error("Generate SO number error:", soNumberError)
      return NextResponse.json({ error: "Failed to generate sales order number" }, { status: 500 })
    }

    const soNumber = soNumberData as string

    // Extract payment details - use the sales rep's edits when provided, otherwise fall
    // back to what was stored on the quotation.
    const paymentDetails = (hasEdits ? overridePaymentDetails : quotation.payment_details) || {}
    const paymentType = (hasEdits ? overridePaymentType : quotation.payment_type) || "cash"

    // Helper: convert empty strings to null for date columns (Postgres rejects "")
    const safeDate = (value: any): string | null => {
      if (value === undefined || value === null || value === "") return null
      return value
    }

    // Create a new sales order from the approved quotation
    const { data: salesOrder, error: soError } = await supabase
      .from("sales_orders")
      .insert({
        so_number: soNumber,
        customer_id: (hasEdits ? overrideCustomerId : quotation.customer_id) || null,
        status: "pending_accountant",
        subtotal: hasEdits && overrideSubtotal !== undefined ? overrideSubtotal : quotation.subtotal,
        total: hasEdits && overrideTotal !== undefined ? overrideTotal : quotation.total,
        net_total:
          hasEdits && overrideNetTotal !== undefined ? overrideNetTotal : quotation.net_total || quotation.total,
        notes: hasEdits ? overrideNotes ?? null : quotation.notes,
        order_date: safeDate(quotation.order_date) || new Date().toISOString().split('T')[0],
        parent_quotation_id: quotation.id,
        approval_document_url: approval_document_url || null,
        // Quotation info
        quotation_request_number: quotation.quotation_request_number,
        department_name: quotation.department_name,
        receiver_name: quotation.receiver_name,
        so_type: quotation.so_type || 'EQUIPMENT',
        // Delivery info
        delivery_date: safeDate(quotation.delivery_date),
        delivery_address: hasEdits ? overrideDeliveryAddress ?? null : quotation.delivery_address,
        delivery_contact_name: hasEdits ? overrideDeliveryContactName ?? null : quotation.delivery_contact_name,
        delivery_contact_phone: hasEdits ? overrideDeliveryContactPhone ?? null : quotation.delivery_contact_phone,
        // Discount info
        discount_type: (hasEdits ? overrideDiscountType : quotation.discount_type) || 'none',
        discount_value: (hasEdits ? overrideDiscountValue : quotation.discount_value) || 0,
        discount_amount: (hasEdits ? overrideDiscountAmount : quotation.discount_amount) || 0,
        // Payment info
        payment_type: paymentType,
        // payment_terms only allows 'prepaid' or 'installment' - map accordingly
        payment_terms: paymentType === "installments" || paymentType === "hybrid" ? "installment" : "prepaid",
        installments: paymentDetails.installmentMonths || null,
        monthly_amount: paymentDetails.monthlyAmount || null,
        payment_start_date: safeDate(paymentDetails.paymentStartDate),
        // Down payment (for hybrid)
        down_payment_type: paymentDetails.downPaymentType || null,
        down_payment_percent: paymentDetails.downPaymentPercent || null,
        down_payment_amount: paymentDetails.downPaymentAmount || null,
        down_payment_due_date: safeDate(paymentDetails.downPaymentDueDate),
        down_payment_cheque_number: paymentDetails.downPaymentChequeNumber || null,
        down_payment_cheque_bank: paymentDetails.downPaymentChequeBank || null,
        down_payment_cheque_due_date: safeDate(paymentDetails.downPaymentChequeDueDate),
        remaining_installment_months: paymentDetails.remainingInstallmentMonths || null,
        remaining_amount: paymentDetails.remainingAmount || null,
        // Cheque info
        cheque_number: paymentDetails.chequeNumber || null,
        cheque_bank_name: paymentDetails.chequeBankName || null,
        cheque_due_date: safeDate(paymentDetails.chequeDueDate),
        cheque_amount: paymentDetails.chequeAmount || null,
        cheque_notes: paymentDetails.chequeNotes || null,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .select()
      .single()

    if (soError || !salesOrder) {
      console.error("Create sales order error:", soError)
      return NextResponse.json({ error: "Failed to create sales order" }, { status: 500 })
    }

    // Create sales order items - from the sales rep's edited item list when provided
    // (e.g. some quoted items weren't approved), otherwise straight from the quotation.
    const sourceItems = hasEdits ? overrideItems : quotation.items
    if (sourceItems && sourceItems.length > 0) {
      const soItems = sourceItems.map((item: any) => {
        const isOutsourced = item.item_type === "outsourced"
        if (hasEdits) {
          return {
            so_id: salesOrder.so_id,
            product_id: isOutsourced ? null : item.product_id ? Number(item.product_id) : null,
            quantity: item.quantity,
            unit_price: item.unit_price,
            total: item.quantity * item.unit_price,
            item_type: isOutsourced ? "outsourced" : "stock",
            item_category: item.item_category || null,
            outsourced_name: isOutsourced ? item.product_name : null,
            outsourced_description: item.supplier_name ? `Supplier: ${item.supplier_name}` : null,
            outsourced_unit: isOutsourced ? item.outsourced_unit || "unit" : null,
            supplier_id: isOutsourced && item.supplier_id ? Number(item.supplier_id) : null,
          }
        }
        return {
          so_id: salesOrder.so_id,
          product_id: item.product_id || null,
          quantity: item.quantity,
          unit_price: item.unit_price,
          total: item.quantity * item.unit_price,
          item_type: isOutsourced ? "outsourced" : "stock",
          outsourced_name: isOutsourced ? item.product_name : null,
          outsourced_description: item.supplier_name ? `Supplier: ${item.supplier_name}` : null,
        }
      })

      const { error: itemsError } = await supabase
        .from("sales_order_items")
        .insert(soItems)

      if (itemsError) {
        console.error("Create SO items error:", itemsError)
        // Don't fail the whole operation, just log it
      }
    }

    // Update the quotation status to approved
    const { error: updateError } = await supabase
      .from("sales_quotations")
      .update({
        status: "approved",
        updated_at: new Date().toISOString(),
      })
      .eq("id", quotation_id)

    if (updateError) {
      console.error("Update quotation status error:", updateError)
    }

    return NextResponse.json({
      sales_order: {
        so_id: salesOrder.so_id,
        so_number: salesOrder.so_number,
        total: salesOrder.total,
      },
      message: `Quotation approved! Sales Order ${salesOrder.so_number} created with status "pending_accountant".`,
    })
  } catch (error) {
    console.error("Approve quotation error:", error)
    return NextResponse.json({ error: "Failed to approve quotation" }, { status: 500 })
  }
}
