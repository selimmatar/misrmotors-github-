import { createAdminClient } from "@/lib/supabase/admin"
import { getConvertedSo, LOCKED_QUOTATION_STATUSES } from "@/lib/sales-quotations/converted"
import { buildSalesOrderPaymentFields } from "@/lib/payment-type"
import { loadAvailability } from "@/lib/stock-hold"
import { isNewQuotationWorkflow } from "@/lib/workflow-switch"
import { runApprovalSideEffects } from "@/lib/sales-orders/on-approved"
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

    // Same availability check as SO POST (lib/stock-hold.ts): available = on-hand - stock held by other approved
    // sales orders (and, in the new workflow, by other waiting quotations: this quotation's own hold is not counted
    // against it). Lines of the same product are added up. Outsourced lines are not checked.
    const stockLines = quotationItems.filter((item) => item.item_type !== "outsourced" && item.product_id)
    if (stockLines.length > 0) {
      let availability: Awaited<ReturnType<typeof loadAvailability>>
      try {
        availability = await loadAvailability(supabase, stockLines.map((item) => Number(item.product_id)), { excludeQuotationId: quotation.id })
      } catch (inventoryError) {
        console.error("Approve quotation: Error fetching inventory", inventoryError)
        return NextResponse.json({ error: "Failed to validate inventory" }, { status: 500 })
      }
      const requested = new Map<number, { qty: number; name: string }>()
      for (const item of stockLines) {
        const id = Number(item.product_id)
        const entry = requested.get(id) || { qty: 0, name: item.product_name }
        entry.qty += Number(item.quantity) || 0
        requested.set(id, entry)
      }
      for (const [productId, { qty, name }] of requested) {
        const availableQty = availability.get(productId)?.available || 0
        if (qty > availableQty) {
          return NextResponse.json(
            { error: `Insufficient inventory for ${name || "product"}. Requested: ${qty}, Available: ${availableQty}` },
            { status: 400 },
          )
        }
      }
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

    // New workflow: the sales rep's conversion IS the approval (stored as "accountant_approved", shown as "Approved",
    // so every existing hold / revenue / delivery-permit rule applies unchanged). Old workflow: the accountant approves.
    const newWorkflow = isNewQuotationWorkflow()
    const soStatus = newWorkflow ? "accountant_approved" : "pending_accountant"

    // Create a new sales order from the approved quotation
    const { data: salesOrder, error: soError } = await supabase
      .from("sales_orders")
      .insert({
        so_number: soNumber,
        customer_id: quotation.customer_id || null,
        status: soStatus,
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
        // Payment info. payment_terms only allows 'prepaid' or 'installment' (DB CHECK, unchanged).
        // Cash / bank transfer / cheque are single payments: they get installments = 1 and no installment,
        // down-payment or (for non-cheque) cheque fields, whatever default values the quotation JSON holds.
        // Installments and hybrid are copied exactly as before.
        ...buildSalesOrderPaymentFields(paymentType, paymentDetails),
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
        cost_estimate: isOutsourced ? item.unit_cost ?? null : null,
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

    // What the accountant's approval used to do (the down-payment invoice of a hybrid order) happens now.
    if (newWorkflow) {
      try {
        await runApprovalSideEffects(supabase, salesOrder)
      } catch (sideEffectError: any) {
        console.error("Approve quotation: approval side effects failed:", sideEffectError?.message)
      }
    }

    // The quotation's price requests now belong to the sales order too (the PO screen suggests them).
    const { error: prLinkError } = await supabase
      .from("po_requests")
      .update({ so_id: salesOrder.so_id, updated_at: new Date().toISOString() })
      .eq("sales_quotation_id", quotation.id)
    if (prLinkError) console.error("Approve quotation: could not link price requests to the sales order:", prLinkError)

    return NextResponse.json({
      sales_order: {
        so_id: salesOrder.so_id,
        so_number: salesOrder.so_number,
        total: salesOrder.total,
      },
      message: newWorkflow
        ? `Quotation approved! Sales Order ${salesOrder.so_number} created and approved.`
        : `Quotation approved! Sales Order ${salesOrder.so_number} created with status "pending_accountant".`,
    })
  } catch (error) {
    console.error("Approve quotation error:", error)
    return NextResponse.json({ error: "Failed to approve quotation" }, { status: 500 })
  }
}
