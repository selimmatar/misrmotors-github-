import { cleanCustomerPo } from "@/lib/eta/customer-po"
import { createAdminClient } from "@/lib/supabase/admin"
import { getConvertedSo, LOCKED_QUOTATION_STATUSES } from "@/lib/sales-quotations/converted"
import { buildSalesOrderPaymentFields } from "@/lib/payment-type"
import { loadAvailability } from "@/lib/stock-hold"
import { isNewQuotationWorkflow } from "@/lib/workflow-switch"
import { runApprovalSideEffects } from "@/lib/sales-orders/on-approved"
import { hasLineOrderColumn, sortQuotationLines } from "@/lib/line-order"
import { type NextRequest, NextResponse } from "next/server"
import { badNumberResponse, cleanManualNumber, insertWithNumber, numberTakenResponse } from "@/lib/doc-number"
import { checkStoredPicks, fromStockLineFields, reserveStoredPicks } from "@/lib/outsourced-hold"
import { quotationFromInventoryId } from "@/lib/quotations/from-stock"

// Converts a quotation into a sales order using the values STORED on the quotation.
// Edits made in the "Approve & Convert" dialog must be saved first (PATCH
// /api/sales-quotations); any edit fields sent in the request body are ignored.
export async function POST(request: NextRequest) {
  try {
    const supabase = createAdminClient()
    const body = await request.json()
    const { quotation_id, approval_document_url } = body
    // Optional sales order number typed by the person (lib/doc-number.ts); empty = the next automatic number.
    const manual = cleanManualNumber(body.manualNumber)
    if (!manual.ok) return badNumberResponse(manual.error)
    // Optional: the customer's purchase order number (lib/eta/customer-po.ts); sent to the tax portal when given.
    const customerPo = cleanCustomerPo(body.customerPo)
    if (!customerPo.ok) return NextResponse.json({ error: customerPo.error }, { status: 400 })

    if (!quotation_id) {
      return NextResponse.json({ error: "Quotation ID is required" }, { status: 400 })
    }

    // Fetch the quotation from sales_quotations table
    const { data: quotation, error: quotationError } = await supabase
      .from("sales_quotations")
      .select("*")
      .eq("id", quotation_id)
      .single()

    if (quotationError || !quotation) {
      console.error("Fetch quotation error:", quotationError)
      return NextResponse.json({ error: "Quotation not found" }, { status: 404 })
    }
    const { data: quotationItemRows, error: quotationItemsError } = await supabase
      .from("sales_quotation_items")
      .select("*")
      .eq("quotation_id", quotation.id)
      .order("line_no", { ascending: true })
      .order("id", { ascending: true })
    if (quotationItemsError) {
      console.error("Fetch quotation items error:", quotationItemsError)
      return NextResponse.json({ error: "Failed to read the quotation's items" }, { status: 500 })
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

    // The sales order's lines follow the quotation's line order (line_no, then id).
    const quotationItems: any[] = sortQuotationLines(quotationItemRows)
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
    // New workflow: a short quotation still converts (the order waits for stock through Missing Items); the
    // shortage is returned as `missing`. Old workflow: it is refused.
    const newWorkflow = isNewQuotationWorkflow()
    const missing: { productId: number; name: string; requested: number; available: number; missing: number }[] = []
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
        if (qty > availableQty && newWorkflow) {
          missing.push({ productId, name: name || "product", requested: qty, available: availableQty, missing: qty - availableQty })
        } else if (qty > availableQty) {
          return NextResponse.json(
            { error: `Insufficient inventory for ${name || "product"}. Requested: ${qty}, Available: ${availableQty}` },
            { status: 400 },
          )
        }
      }
    }

    // Lines taken from free stored stock (lib/quotations/from-stock.ts): checked now like the sales order form does
    // (the row must still be free), reserved for the new order once it exists (lib/outsourced-hold.ts).
    const storedPicks = quotationItems
      .filter((item) => item.item_type === "outsourced" && quotationFromInventoryId(item) !== null)
      .map((item) => ({ inventoryId: quotationFromInventoryId(item)!, quantity: Number(item.quantity) }))
    let storedCheck: Awaited<ReturnType<typeof checkStoredPicks>>
    try {
      storedCheck = await checkStoredPicks(supabase, storedPicks)
    } catch (storedError: any) {
      console.error("Approve quotation: could not check the stored items:", storedError?.message || storedError)
      return NextResponse.json({ error: "Failed to validate inventory" }, { status: 500 })
    }
    if (!storedCheck.ok) return NextResponse.json({ error: storedCheck.error, code: storedCheck.code }, { status: storedCheck.status })

    const nextSoNumber = async () => {
      const { data: soNumberData, error: soNumberError } = await supabase.rpc("generate_so_number")
      if (soNumberError) console.error("Generate SO number error:", soNumberError)
      return soNumberError ? null : ((soNumberData as string) || null)
    }

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
    const soStatus = newWorkflow ? "accountant_approved" : "pending_accountant"

    // Create a new sales order from the approved quotation
    const created = await insertWithNumber<any>(manual.value, nextSoNumber, (soNumber) => supabase
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
        ...(customerPo.value ? { customer_po: customerPo.value } : {}),
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
      .single())
    if (!created.ok && created.reason === "no_number") {
      return NextResponse.json({ error: "Failed to generate sales order number" }, { status: 500 })
    }
    if (!created.ok && created.reason === "taken") return numberTakenResponse(created.number)
    const salesOrder: any = created.ok ? created.data : null
    const soError = created.ok ? null : created.reason === "error" ? created.error : null

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

    // Reserve the stored items for the new order (the picked row, or the part split off it)
    let reservation: Awaited<ReturnType<typeof reserveStoredPicks>> | null = null
    if (storedPicks.length > 0 && storedCheck.ok) {
      try {
        reservation = await reserveStoredPicks(supabase, salesOrder.so_number, storedPicks, storedCheck.rows)
      } catch (reserveError: any) {
        console.error("Approve quotation: could not reserve the stored items:", reserveError?.message || reserveError)
        await supabase.from("sales_orders").delete().eq("so_id", salesOrder.so_id)
        return NextResponse.json(
          { error: "A stored item on this quotation was changed by someone else. Nothing was saved; please try again.", code: "STORED_ITEM_CHANGED" },
          { status: 409 },
        )
      }
    }

    // Inserted in line order (so_item_id order); line_order is written too once the column exists.
    const withLineOrder = await hasLineOrderColumn(supabase)
    const soItems = quotationItems.map((item: any, index: number) => {
      const isOutsourced = item.item_type === "outsourced"
      const picked = isOutsourced ? quotationFromInventoryId(item) : null
      if (picked !== null && reservation && storedCheck.ok) {
        // a from-stock line, named like the stored item and marked with its reserved row (lib/from-stock-line.ts)
        return {
          ...(withLineOrder ? { line_order: index + 1 } : {}),
          so_id: salesOrder.so_id,
          quantity: item.quantity,
          unit_price: item.unit_price,
          total: item.quantity * item.unit_price,
          item_category: itemCategory,
          outsourced_unit: "unit",
          supplier_id: item.supplier_name ? supplierIdByName.get(item.supplier_name) || null : null,
          ...fromStockLineFields(storedCheck.rows.get(picked), reservation.reserved.get(picked) ?? picked),
        }
      }
      return {
        ...(withLineOrder ? { line_order: index + 1 } : {}),
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
      if (reservation) await reservation.undo()
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
      missing,
      message: newWorkflow
        ? `Quotation approved! Sales Order ${salesOrder.so_number} created and approved.`
        : `Quotation approved! Sales Order ${salesOrder.so_number} created with status "pending_accountant".`,
    })
  } catch (error) {
    console.error("Approve quotation error:", error)
    return NextResponse.json({ error: "Failed to approve quotation" }, { status: 500 })
  }
}
