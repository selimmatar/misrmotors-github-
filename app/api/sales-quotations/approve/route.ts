import { createAdminClient } from "@/lib/supabase/admin"
import { getConvertedSo, LOCKED_QUOTATION_STATUSES } from "@/lib/sales-quotations/converted"
import { type NextRequest, NextResponse } from "next/server"

// Converts a quotation into a sales order using the values STORED on the quotation.
// Edits made in the "Approve & Convert" dialog must be saved first (PATCH
// /api/sales-quotations); any edit fields sent in the request body are ignored.
export async function POST(request: NextRequest) {
  try {
    const supabase = createAdminClient()
    const body = await request.json()
    const { quotation_id, approval_document_url } = body

    if (!quotation_id) {
      return NextResponse.json({ error: "Quotation ID is required" }, { status: 400 })
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

    // Rejected / expired quotations can't be converted.
    if (LOCKED_QUOTATION_STATUSES.includes(quotation.status)) {
      console.error("Quotation not convertible, current status:", quotation.status)
      return NextResponse.json({ error: `This quotation is ${quotation.status} and cannot be converted.` }, { status: 400 })
    }

    // A quotation can only be converted once: a sales order already points at it.
    const alreadyConverted = await getConvertedSo(supabase, quotation.id)
    if (alreadyConverted) {
      return NextResponse.json(
        { error: `This quotation has already been converted to Sales Order ${alreadyConverted.so_number}.` },
        { status: 409 },
      )
    }

    const quotationItems: any[] = [...(quotation.items || [])].sort((x, y) => (x.line_no || 0) - (y.line_no || 0))
    if (quotationItems.length === 0) {
      return NextResponse.json({ error: "This quotation has no items and cannot be converted to a sales order." }, { status: 400 })
    }
    const itemWithoutProduct = quotationItems.find((item) => item.item_type !== "outsourced" && !item.product_id)
    if (itemWithoutProduct) {
      return NextResponse.json(
        { error: `Item "${itemWithoutProduct.product_name}" has no product and cannot be converted to a sales order.` },
        { status: 400 },
      )
    }

    // Generate SO number
    const { data: soNumberData, error: soNumberError } = await supabase.rpc("generate_so_number")
    
    if (soNumberError) {
      console.error("Generate SO number error:", soNumberError)
      return NextResponse.json({ error: "Failed to generate sales order number" }, { status: 500 })
    }

    const soNumber = soNumberData as string

    // Payment details come from what is stored on the quotation.
    const paymentDetails = quotation.payment_details || {}
    const paymentType = quotation.payment_type || "cash"

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
        customer_id: quotation.customer_id || null,
        status: "pending_accountant",
        subtotal: quotation.subtotal,
        total: quotation.total,
        net_total: quotation.net_total || quotation.total,
        notes: quotation.notes,
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
        delivery_address: quotation.delivery_address,
        delivery_contact_name: quotation.delivery_contact_name,
        delivery_contact_phone: quotation.delivery_contact_phone,
        // Discount info
        discount_type: quotation.discount_type || 'none',
        discount_value: quotation.discount_value || 0,
        discount_amount: quotation.discount_amount || 0,
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

    // Race guard: if another request converted the same quotation at the same moment, only
    // the earliest sales order survives. This request removes only the order it just created.
    const firstChild = await getConvertedSo(supabase, quotation.id)
    if (firstChild && firstChild.so_id !== salesOrder.so_id) {
      await supabase.from("sales_orders").delete().eq("so_id", salesOrder.so_id)
      return NextResponse.json(
        { error: `This quotation has already been converted to Sales Order ${firstChild.so_number}.` },
        { status: 409 },
      )
    }

    // Create the sales order items from the stored quotation items. If they can't be
    // created, remove the order header just created (its items cascade) rather than
    // leaving an order without lines.
    const itemCategory = quotation.so_type === "MAINTENANCE_PARTS" ? "MAINTENANCE_PARTS" : "EQUIPMENT"

    const outsourcedSupplierNames = Array.from(
      new Set(quotationItems.filter((item) => item.item_type === "outsourced" && item.supplier_name).map((item) => item.supplier_name)),
    )
    const supplierIdByName = new Map<string, number>()
    if (outsourcedSupplierNames.length > 0) {
      const { data: supplierRows } = await supabase
        .from("suppliers")
        .select("supplier_id, supplier_name")
        .in("supplier_name", outsourcedSupplierNames)
      for (const row of supplierRows || []) supplierIdByName.set(row.supplier_name, row.supplier_id)
    }

    const soItems = quotationItems.map((item: any) => {
      const isOutsourced = item.item_type === "outsourced"
      return {
        so_id: salesOrder.so_id,
        product_id: isOutsourced ? null : Number(item.product_id),
        quantity: item.quantity,
        unit_price: item.unit_price,
        total: item.quantity * item.unit_price,
        item_type: isOutsourced ? "outsourced" : "stock",
        item_category: itemCategory,
        outsourced_name: isOutsourced ? item.product_name : null,
        outsourced_description: item.supplier_name ? `Supplier: ${item.supplier_name}` : null,
        outsourced_unit: isOutsourced ? "unit" : null,
        supplier_id: isOutsourced && item.supplier_name ? supplierIdByName.get(item.supplier_name) || null : null,
      }
    })

    const { error: itemsError } = await supabase.from("sales_order_items").insert(soItems)

    if (itemsError) {
      console.error("Create SO items error:", itemsError)
      const { error: rollbackError } = await supabase.from("sales_orders").delete().eq("so_id", salesOrder.so_id)
      if (rollbackError) console.error("Rollback: failed to remove sales order without items:", rollbackError)
      return NextResponse.json({ error: "Failed to create sales order items" }, { status: 500 })
    }

    // The quotation's own status is intentionally not changed: a quotation counts as
    // converted once a sales order references it through parent_quotation_id.

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
