import { createAdminClient } from "@/lib/supabase/admin"
import { parsePositiveId } from "@/lib/parse-id"
import { isPoAutoApprove } from "@/lib/workflow-switch"
import { withRetry } from "@/lib/supabase/rate-limit-handler"
import { NextResponse } from "next/server"
import { badNumberResponse, cleanManualNumber, insertWithNumber, numberTakenResponse } from "@/lib/doc-number"
import { isAllowedPoTransition, PO_ITEMS_EDITABLE_STATUSES } from "@/lib/po-status"
import { checkPoOverOrder, linesWithIncreasedQuantity } from "@/lib/po-over-order"
import { computePoTotals, mapPoItem, poPaymentColumns } from "@/lib/po-items"
import {
  SUPPLIER_CREDIT_PAYMENT_METHOD,
  parseCreditSelections,
  releaseSupplierCredits,
  mergeReleasedRemainders,
  reserveSupplierCredits,
  reservedCreditTotal,
  validateCreditSelections,
} from "@/lib/supplier-credit-apply"

// The only columns PUT may write, keyed by every spelling a caller may send. The UI sends status, payment_type,
// total (ignored: recomputed from the items) and rejectionReason; the approve / reject metadata and the payment
// schedule are kept for the existing callers. Anything else (po_number, supplier, cost-finalize fields, tax,
// approved_at, ...) is ignored.
const PO_PUT_COLUMNS: Record<string, string> = {
  status: "status",
  payment_type: "payment_type",
  paymentType: "payment_type",
  payment_terms: "payment_terms",
  paymentTerms: "payment_terms",
  rejection_reason: "rejection_reason",
  rejectionReason: "rejection_reason",
  rejected_by: "rejected_by",
  rejectedBy: "rejected_by",
  rejected_at: "rejected_at",
  rejectedAt: "rejected_at",
  approved_by: "approved_by",
  approvedBy: "approved_by",
  schedule_entries: "schedule_entries",
}

export const dynamic = "force-dynamic"

export async function GET() {
  try {

    const result = await withRetry(async () => {
      const supabase = createAdminClient()

      const { data: orders, error: ordersError } = await supabase
        .from("purchase_orders")
        .select("*")
        .order("created_at", { ascending: false })

      if (ordersError) {
        console.error("Purchase Orders GET: Error fetching orders", ordersError)
        throw ordersError
      }

      const orderIds = orders.map((o) => o.po_id)
      const { data: allItems, error: itemsError } = await supabase
        .from("purchase_order_items")
        .select(`
          *,
          products:product_id (
            product_name,
            sku,
            unit
          )
        `)
        .in("po_id", orderIds)

      if (itemsError) {
        console.error("Purchase Orders GET: Error fetching items", itemsError)
        // Don't throw, just continue with empty items
      }


      const itemsByPoId: Record<number, any[]> = {}
      for (const item of allItems || []) {
        if (!itemsByPoId[item.po_id]) {
          itemsByPoId[item.po_id] = []
        }
        itemsByPoId[item.po_id].push(item)
      }

      // Price request numbers, for the PO list's "PR" column and search (no FK embed: older POs have none), and the
      // sales order the PR belongs to, for the "For sales order" column when the PO lines carry none.
      const prIds = [...new Set(orders.map((o) => o.po_request_id).filter(Boolean))]
      const prNumbers: Record<number, string> = {}
      const prSoIds: Record<number, number> = {}
      if (prIds.length > 0) {
        const { data: prs, error: prsError } = await supabase.from("po_requests").select("request_id, request_number, so_id").in("request_id", prIds)
        if (prsError) console.error("Purchase Orders GET: Error fetching price requests", prsError)
        for (const pr of prs || []) {
          prNumbers[pr.request_id] = pr.request_number
          if (pr.so_id) prSoIds[pr.request_id] = pr.so_id
        }
      }

      const ordersWithItems = orders.map((order) => {
        const items = itemsByPoId[order.po_id] || []

        let scheduleEntries = null
        if (order.schedule_entries) {
          try {
            scheduleEntries =
              typeof order.schedule_entries === "string" ? JSON.parse(order.schedule_entries) : order.schedule_entries
          } catch (e) {
            console.error("Error parsing schedule_entries for PO:", order.po_id)
          }
        }

        return {
          id: order.po_id.toString(),
          poNumber: order.po_number,
          supplierId: order.supplier_id.toString(),
          poRequestId: order.po_request_id ? order.po_request_id.toString() : undefined,
          poRequestNumber: order.po_request_id ? prNumbers[order.po_request_id] : undefined,
          poRequestSoId: order.po_request_id && prSoIds[order.po_request_id] ? prSoIds[order.po_request_id].toString() : undefined,
          orderDate: order.order_date,
          deliveryDate: order.delivery_date,
          status: order.status,
          paymentTerms: order.payment_terms,
          installments: order.installments,
          currency: order.currency || "EGP",
          total: order.total,
          poInvoiceUrl: order.invoice_file_url,
          rejectionReason: order.rejection_reason,
          rejectedBy: order.rejected_by,
          rejectedAt: order.rejected_at,
          approvedBy: order.approved_by,
          approvedAt: order.approved_at,
          createdBy: order.created_by,
          createdAt: order.created_at,
          updatedAt: order.updated_at,
          taxAmount: order.tax_amount,
          otherCosts: order.other_costs,
          costFinalized: order.cost_finalized,
          costFinalizedAt: order.cost_finalized_at,
          costFinalizedBy: order.cost_finalized_by,
          poType: order.po_type || "local",
          paymentType: order.payment_type || order.payment_terms,
          downPaymentAmount: order.down_payment_amount,
          downPaymentPercent: order.down_payment_percent,
          downPaymentType: order.down_payment_type,
          downPaymentChequeBank: order.down_payment_cheque_bank,
          downPaymentChequeNumber: order.down_payment_cheque_number,
          downPaymentChequeDueDate: order.down_payment_cheque_due_date,
          chequeNumber: order.cheque_number,
          chequeBankName: order.cheque_bank_name,
          chequeDueDate: order.cheque_due_date,
          chequeAmount: order.cheque_amount,
          chequeNotes: order.cheque_notes,
          downPaymentDueDate: order.down_payment_due_date,
          remainingAmount: order.remaining_amount,
          remainingInstallmentMonths: order.remaining_installment_months,
          monthlyAmount: order.monthly_amount,
          paymentStartDate: order.payment_start_date,
          scheduleEntries: scheduleEntries,
          scheduleMode: order.schedule_mode || "AUTO",
          // Also keep snake_case for backwards compatibility
          po_id: order.po_id,
          po_number: order.po_number,
          supplier_id: order.supplier_id.toString(),
          payment_terms: order.payment_terms,
          po_type: order.po_type || "local",
          items: items.map((item: any) => ({
            id: item.po_item_id?.toString(),
            productId: item.product_id?.toString(),
            productName:
              item.item_type === "outsourced"
                ? item.outsourced_name || item.item_name_snapshot || "Outsourced Item"
                : item.products?.product_name || item.item_name_snapshot || "Unknown Product",
            sku: item.products?.sku || "",
            unit: item.item_type === "outsourced" ? item.outsourced_unit || "" : item.products?.unit || "pcs",
            quantity: item.quantity,
            unitPrice: item.unit_price,
            total: item.total,
            allocatedTax: item.allocated_tax,
            allocatedOverhead: item.allocated_overhead,
            landedCost: item.landed_cost,
            itemType: item.item_type || "stock",
            outsourcedName: item.outsourced_name || "",
            outsourcedDescription: item.outsourced_description || "",
            outsourcedUnit: item.outsourced_unit || "",
            sourceSoId: item.source_so_id?.toString() || "",
            sourceSoItemId: item.source_so_item_id?.toString() || "",
          })),
          bankName: order.bank_name,
          bankAccountNumber: order.bank_account_number,
          bankSwiftCode: order.bank_swift_code,
          bankIban: order.bank_iban,
          bankBranch: order.bank_branch,
          bankHolderName: order.bank_holder_name,
        }
      })

      return ordersWithItems
    })

    return NextResponse.json(result)
  } catch (error) {
    console.error("Purchase Orders GET: Error", error)
    return NextResponse.json({ error: "Failed to fetch purchase orders" }, { status: 500 })
  }
}

export async function POST(request: Request) {
  try {
    const supabase = createAdminClient()

    const body = await request.json()
    const { items, allow_over_order, credits, ...orderData } = body
    const allowOverOrder = allow_over_order === true
    // Optional PO number typed by the person (lib/doc-number.ts); empty = the next automatic number.
    const manual = cleanManualNumber(body.manualNumber)
    if (!manual.ok) return badNumberResponse(manual.error)

    const parsedCredits = parseCreditSelections(credits)
    if (!parsedCredits.ok) return NextResponse.json(parsedCredits.result.body, { status: parsedCredits.result.status })

    // Do not order more from suppliers than the sales order lines need (400/409 before anything is written).
    // The user may confirm ordering more anyway (allow_over_order: true); an unknown SO line is still refused.
    // Known limit: two concurrent POSTs can still both pass; closing that needs a DB constraint (not approved).
    const overOrder = await checkPoOverOrder(supabase, items)
    if (!overOrder.ok && !(allowOverOrder && overOrder.code === "PO_OVER_ORDER")) {
      return NextResponse.json(
        { error: overOrder.error, code: overOrder.code, lines: overOrder.lines },
        { status: overOrder.status },
      )
    }
    if (!overOrder.ok) console.warn("Purchase Orders POST: over-order confirmed by the user", JSON.stringify(overOrder.lines))

    const mappedItems = (Array.isArray(items) ? items : []).map((item: any) => mapPoItem(item, 0))
    const poTotals = computePoTotals(mappedItems, Number(orderData.tax_amount ?? orderData.taxAmount) > 0)

    // Supplier credits to deduct (FEAT-01): checked before anything is written, reserved once the PO exists.
    // Credits are EGP amounts (raised from returns); the PO total has no conversion, so other currencies cannot take them.
    if (parsedCredits.selections.length > 0 && String(orderData.currency || "EGP").toUpperCase() !== "EGP") {
      return NextResponse.json(
        { error: "Supplier credits are in EGP and can only be deducted from an EGP purchase order", code: "CREDIT_CURRENCY" },
        { status: 409 },
      )
    }
    const creditCheck = await validateCreditSelections(supabase, {
      supplierId: Number(orderData.supplier_id || orderData.supplierId),
      poTotal: poTotals.total,
      selections: parsedCredits.selections,
    })
    if (!creditCheck.ok) return NextResponse.json(creditCheck.result.body, { status: creditCheck.result.status })

    // Optional price request (PR) this PO answers: one PR = one supplier = one PO, so it must be the same supplier
    // and not already used or cancelled. Checked before anything is written; marked "converted" once the PO exists.
    const rawPoRequestId = orderData.po_request_id ?? orderData.poRequestId
    let poRequestId: number | null = null
    if (rawPoRequestId !== undefined && rawPoRequestId !== null && rawPoRequestId !== "") {
      poRequestId = parsePositiveId(String(rawPoRequestId))
      if (!poRequestId) return NextResponse.json({ error: "Invalid po_request_id" }, { status: 400 })
      const { data: poRequest, error: poRequestError } = await supabase
        .from("po_requests")
        .select("request_id, supplier_id, status")
        .eq("request_id", poRequestId)
        .maybeSingle()
      if (poRequestError) throw poRequestError
      if (!poRequest) return NextResponse.json({ error: "Price request not found" }, { status: 404 })
      if (Number(poRequest.supplier_id) !== Number(orderData.supplier_id || orderData.supplierId)) {
        return NextResponse.json({ error: "The price request is for another supplier", code: "PR_SUPPLIER" }, { status: 400 })
      }
      if (poRequest.status !== "pending" && poRequest.status !== "quoted") {
        return NextResponse.json({ error: "The price request is already used or cancelled", code: "PR_CLOSED" }, { status: 409 })
      }
    }

    // The automatic PO number is generated server-side (obfuscated, atomic); po_number / poNumber sent by the client
    // are ignored. Only `manualNumber`, a number the person typed on purpose, replaces it.
    const nextPoNumber = async () => {
      const { data: generatedPoNumber, error: poNumberError } = await supabase.rpc("generate_po_number")
      if (poNumberError) console.error("Purchase Orders POST: Failed to generate PO number", poNumberError)
      return poNumberError ? null : ((generatedPoNumber as string) || null)
    }

    const orderWithCurrency: Record<string, any> = {
      po_number: null,
      supplier_id: orderData.supplier_id || orderData.supplierId,
      order_date: orderData.order_date || orderData.orderDate,
      delivery_date: orderData.delivery_date || orderData.deliveryDate,
      // A new PO always starts in the normal initial state (the form sends "pending"); a client can never create
      // it already approved/received, which would skip the approval and the AP invoice.
      status: String(orderData.status || "").trim().toLowerCase() === "draft" ? "draft" : "pending",
      total: poTotals.total,
      currency: orderData.currency || "EGP",
      po_type: orderData.po_type || orderData.poType || "local",
      invoice_file_url: orderData.invoice_file_url || orderData.invoiceFileUrl || orderData.poInvoiceUrl || null,
      // Approval / rejection / cost-finalize fields are written only by their own workflows, never at creation.
      rejection_reason: null,
      rejected_by: null,
      rejected_at: null,
      approved_by: null,
      approved_at: null,
      created_by: orderData.created_by || orderData.createdBy || null,
      tax_amount: poTotals.tax || null,
      other_costs: null,
      cost_finalized: null,
      cost_finalized_at: null,
      cost_finalized_by: null,
      ...poPaymentColumns(orderData),
      ...(poRequestId && { po_request_id: poRequestId }),
    }


    const created = await insertWithNumber<any>(manual.value, nextPoNumber, (poNumber) =>
      supabase
        .from("purchase_orders")
        .insert({ ...orderWithCurrency, po_number: poNumber })
        .select()
        .single(),
    )
    if (!created.ok && created.reason === "no_number") {
      return NextResponse.json({ error: "Failed to generate purchase order number" }, { status: 500 })
    }
    if (!created.ok && created.reason === "taken") return numberTakenResponse(created.number)
    const order: any = created.ok ? created.data : null
    const orderError = created.ok ? null : created.reason === "error" ? created.error : null

    if (orderError) {
      console.error("Purchase Orders POST: Error inserting order", orderError)
      throw orderError
    }


    // Do not leave a PO header without its lines or its credits: remove it and fail.
    const removeCreatedPo = async () => {
      const { error: cleanupError } = await supabase.from("purchase_order_items").delete().eq("po_id", order.po_id)
      if (cleanupError) console.error("Purchase Orders POST: could not clean up items", cleanupError)
      const { error: headerDeleteError } = await supabase.from("purchase_orders").delete().eq("po_id", order.po_id)
      if (headerDeleteError) console.error("Purchase Orders POST: could not delete the PO header", headerDeleteError)
    }

    // Insert items if provided
    if (mappedItems.length > 0) {
      const itemsWithPoId = mappedItems.map((item: any) => ({ ...item, po_id: order.po_id }))

      const { error: itemsInsertError } = await supabase.from("purchase_order_items").insert(itemsWithPoId)

      if (itemsInsertError) {
        console.error("Purchase Orders POST: Error inserting items", itemsInsertError)
        await removeCreatedPo()
        return NextResponse.json({ error: "Failed to create purchase order items" }, { status: 500 })
      }
    }

    if (parsedCredits.selections.length > 0) {
      const reserveError = await reserveSupplierCredits(supabase, {
        poId: order.po_id,
        poNumber: order.po_number,
        selections: parsedCredits.selections,
        rows: creditCheck.rows,
      })
      if (reserveError) {
        await removeCreatedPo()
        return NextResponse.json(reserveError.body, { status: reserveError.status })
      }
    }
    if (poRequestId) {
      // The PO is saved; a failure here leaves the PR open (it can still be closed by hand), so it does not fail the PO.
      const { error: prError } = await supabase
        .from("po_requests")
        .update({ status: "converted", updated_at: new Date().toISOString() })
        .eq("request_id", poRequestId)
        .in("status", ["pending", "quoted"])
      if (prError) console.error("Purchase Orders POST: could not mark the price request converted", prError)
    }
    const appliedCredit = Math.round(parsedCredits.selections.reduce((sum, c) => sum + c.amount, 0) * 100) / 100

    // No CEO approval (see lib/workflow-switch.ts): the new PO is approved now. It gets NO supplier bill: a PO stays
    // open (work in progress) until it is closed (POST /api/purchase-orders/close, owner request 2026-11-11).
    let autoApproved: boolean | undefined
    if (isPoAutoApprove() && order.status === "pending") {
      autoApproved = false
      const { data: approvedRows, error: approveError } = await supabase
        .from("purchase_orders")
        .update({ status: "approved", approved_at: new Date().toISOString(), approved_by: order.created_by || null })
        .eq("po_id", order.po_id)
        .eq("status", "pending")
        .select()
      const approvedOrder = !approveError && Array.isArray(approvedRows) ? approvedRows[0] : null
      if (!approvedOrder) {
        console.error("Purchase Orders POST: could not approve the new purchase order", approveError)
      } else {
        Object.assign(order, approvedOrder)
        autoApproved = true
      }
    }

    const createdOrder = {
      id: order.po_id.toString(),
      poNumber: order.po_number,
      supplierId: order.supplier_id.toString(),
      orderDate: order.order_date,
      deliveryDate: order.delivery_date,
      status: order.status,
      paymentTerms: order.payment_terms,
      installments: order.installments,
      currency: order.currency || "EGP",
      total: order.total,
      poInvoiceUrl: order.invoice_file_url,
      rejectionReason: order.rejection_reason,
      rejectedBy: order.rejected_by,
      rejectedAt: order.rejected_at,
      approvedBy: order.approved_by,
      approvedAt: order.approved_at,
      createdBy: order.created_by,
      createdAt: order.created_at,
      updatedAt: order.updated_at,
      taxAmount: order.tax_amount,
      otherCosts: order.other_costs,
      costFinalized: order.cost_finalized,
      costFinalizedAt: order.cost_finalized_at,
      costFinalizedBy: order.cost_finalized_by,
      poType: order.po_type || "local",
      paymentType: order.payment_type || order.payment_terms,
      downPaymentAmount: order.down_payment_amount,
      downPaymentPercent: order.down_payment_percent,
      downPaymentType: order.down_payment_type,
  downPaymentChequeBank: order.down_payment_cheque_bank,
  downPaymentChequeNumber: order.down_payment_cheque_number,
  downPaymentChequeDueDate: order.down_payment_cheque_due_date,
  chequeNumber: order.cheque_number,
  chequeBankName: order.cheque_bank_name,
  chequeDueDate: order.cheque_due_date,
  chequeAmount: order.cheque_amount,
  chequeNotes: order.cheque_notes,
  downPaymentDueDate: order.down_payment_due_date,
      remainingAmount: order.remaining_amount,
      remainingInstallmentMonths: order.remaining_installment_months,
      monthlyAmount: order.monthly_amount,
      paymentStartDate: order.payment_start_date,
      scheduleEntries: order.schedule_entries
        ? typeof order.schedule_entries === "string"
          ? JSON.parse(order.schedule_entries)
          : order.schedule_entries
        : null,
      scheduleMode: order.schedule_mode || "AUTO",
      po_id: order.po_id,
      po_number: order.po_number,
      supplier_id: order.supplier_id.toString(),
      payment_terms: order.payment_terms,
      po_type: order.po_type || "local",
      items: items || [],
      bankName: order.bank_name,
      bankAccountNumber: order.bank_account_number,
      bankSwiftCode: order.bank_swift_code,
      bankIban: order.bank_iban,
      bankBranch: order.bank_branch,
      bankHolderName: order.bank_holder_name,
      appliedCredit,
      ...(autoApproved === undefined ? {} : { autoApproved }),
    }

    return NextResponse.json(createdOrder)
  } catch (error) {
    console.error("Purchase Orders POST: Error", error)
    return NextResponse.json({ error: "Failed to create purchase order" }, { status: 500 })
  }
}

export async function PUT(request: Request) {
  try {
    const supabase = createAdminClient()

    const body = await request.json()
    const { id, items, allow_over_order, ...requested } = body

    // Whitelist: only PO_PUT_COLUMNS are written; every other key in the body is ignored.
    const updates: Record<string, any> = {}
    for (const [key, column] of Object.entries(PO_PUT_COLUMNS)) {
      if (requested[key] !== undefined) updates[column] = requested[key]
    }

    // Only touch schedule_entries when the caller sent it (an approve/reject must not wipe it).
    if (updates.schedule_entries !== undefined) {
      updates.schedule_entries = updates.schedule_entries
        ? typeof updates.schedule_entries === "string"
          ? updates.schedule_entries
          : JSON.stringify(updates.schedule_entries)
        : null
    }

    const poId = Number.parseInt(id)
    if (!Number.isFinite(poId)) {
      return NextResponse.json({ error: "A valid purchase order id is required" }, { status: 400 })
    }

    const { data: current, error: currentError } = await supabase
      .from("purchase_orders")
      .select("*")
      .eq("po_id", poId)
      .maybeSingle()
    if (currentError) {
      console.error("Purchase Orders PUT: Error reading order", currentError)
      return NextResponse.json({ error: "Failed to read purchase order" }, { status: 500 })
    }
    if (!current) {
      return NextResponse.json({ error: "Purchase order not found" }, { status: 404 })
    }

    const previousStatus: string = current.status
    const targetStatus: string = updates.status !== undefined ? updates.status : previousStatus
    if (!isAllowedPoTransition(previousStatus, targetStatus)) {
      return NextResponse.json(
        { error: `A purchase order cannot move from "${previousStatus}" to "${targetStatus}"`, code: "INVALID_PO_TRANSITION" },
        { status: 409 },
      )
    }
    if (items && !PO_ITEMS_EDITABLE_STATUSES.includes(previousStatus)) {
      return NextResponse.json(
        { error: `The items of a "${previousStatus}" purchase order cannot be changed`, code: "PO_ITEMS_LOCKED" },
        { status: 409 },
      )
    }

    // Only the lines of a PO that stays active count; this PO's own current lines are excluded from "already ordered".
    // Only lines whose quantity INCREASED versus what this PO already stores (or new lines) are checked, so an
    // unrelated edit of a PO that already carries a legacy over-ordered line is not blocked.
    if (items && targetStatus !== "rejected") {
      const { data: storedLines, error: storedError } = await supabase
        .from("purchase_order_items")
        .select("source_so_item_id, quantity")
        .eq("po_id", poId)
      if (storedError) {
        console.error("Purchase Orders PUT: Error reading stored lines for the over-order check", storedError)
        return NextResponse.json({ error: "Failed to read purchase order items" }, { status: 500 })
      }
      const overOrder = await checkPoOverOrder(supabase, linesWithIncreasedQuantity(items, storedLines || []), poId)
      if (!overOrder.ok && !(allow_over_order === true && overOrder.code === "PO_OVER_ORDER")) {
        return NextResponse.json(
          { error: overOrder.error, code: overOrder.code, lines: overOrder.lines },
          { status: overOrder.status },
        )
      }
    }

    // The total is never taken from the client. When the items change it is recomputed from them (VAT stays on
    // when the stored PO had VAT); otherwise the stored total stands, so the AP invoice is built from it.
    let newItemRows: any[] | null = null
    if (items) {
      const { data: existingRows, error: existingError } = await supabase
        .from("purchase_order_items")
        .select("po_item_id, item_type, source_so_item_id, outsourced_name")
        .eq("po_id", poId)
      if (existingError) {
        console.error("Purchase Orders PUT: Error reading existing items", existingError)
        throw existingError
      }
      const existingItems = (existingRows || []) as any[]
      newItemRows = (items as any[]).map((item: any) => ({
        ...mapPoItem(item, poId, existingItems),
        allocated_tax: item.allocatedTax || item.allocated_tax,
        allocated_overhead: item.allocatedOverhead || item.allocated_overhead,
        landed_cost: item.landedCost || item.landed_cost,
      }))
      const vatOn = Number(current.tax_amount) > 0
      const totals = computePoTotals(newItemRows, vatOn)
      updates.total = totals.total
      if (vatOn) updates.tax_amount = totals.tax

      // The supplier credits reserved on this PO may never be more than its total.
      if (targetStatus !== "rejected") {
        const reserved = await reservedCreditTotal(supabase, poId)
        if (reserved.error) {
          console.error("Purchase Orders PUT: Error reading reserved credits", reserved.error)
          return NextResponse.json({ error: "Failed to read the supplier credits of this purchase order" }, { status: 500 })
        }
        if (reserved.total > totals.total + 0.005) {
          return NextResponse.json(
            {
              error: `The new total (${totals.total.toFixed(2)}) is less than the supplier credit applied to this order (${reserved.total.toFixed(2)})`,
              code: "CREDIT_EXCEEDS_TOTAL",
              applied: reserved.total,
              total: totals.total,
            },
            { status: 409 },
          )
        }
      }
    }

    const statusChanged = targetStatus !== previousStatus
    const approving = statusChanged && targetStatus === "approved"
    if (approving && updates.approved_at === undefined) updates.approved_at = new Date().toISOString()
    // A repeat approve of an already approved PO is a repair/no-op request: a stale client payload must not
    // overwrite the approved total or payment type (the AP invoice was built from them).
    if (!statusChanged && targetStatus === "approved") {
      delete updates.total
      delete updates.payment_type
      delete updates.payment_terms
    }

    // Compare-and-swap on the status we validated against, so two concurrent requests cannot both win.
    let order: any = null
    if (Object.keys(updates).length === 0) {
      order = current // nothing to write (e.g. an items-only request)
    } else {
      let updateQuery = supabase.from("purchase_orders").update(updates).eq("po_id", poId)
      if (statusChanged) updateQuery = updateQuery.eq("status", previousStatus)
      const { data: updatedRows, error: orderError } = await updateQuery.select()
      if (orderError) {
        console.error("Purchase Orders PUT: Error updating order", orderError)
        return NextResponse.json({ error: orderError.message || "Failed to update purchase order" }, { status: 500 })
      }
      order = Array.isArray(updatedRows) ? updatedRows[0] : null
    }
    if (!order) {
      return NextResponse.json(
        { error: "The purchase order was changed by someone else; reload and try again", code: "PO_STATUS_CONFLICT" },
        { status: 409 },
      )
    }

    if (newItemRows) {
      // The current rows were read above, so lines without an item_type keep theirs (see mapPoItem).
      await supabase.from("purchase_order_items").delete().eq("po_id", poId)

      if (newItemRows.length > 0) {
        const { error: itemsError } = await supabase.from("purchase_order_items").insert(newItemRows)

        if (itemsError) {
          console.error("Purchase Orders PUT: Error updating items", itemsError)
          throw itemsError
        }

      }
    }

    // Approving makes no supplier bill: the PO stays open until it is closed (lib/po-bill.ts, owner request 2026-11-11).

    // A rejected PO gives its supplier credits back, unless an AP invoice already took them (e.g. a failed cleanup
    // after an approval): then they stay applied there and an administrator settles the invoice.
    let creditsReleased: boolean | undefined
    if (statusChanged && targetStatus === "rejected") {
      const { data: apRows, error: apError } = await supabase.from("accounts_payable").select("invoice_id").eq("po_id", poId).limit(1)
      if (apError || (apRows || []).length > 0) {
        creditsReleased = false
        console.error("Purchase Orders PUT: credits not released, the PO has an AP invoice or it could not be checked", apError?.message)
      } else {
        const { data: reservedRows } = await supabase
          .from("supplier_credits")
          .select("credit_id")
          .eq("used_in_po_id", poId)
          .eq("status", "used")
        const releaseError = await releaseSupplierCredits(supabase, poId, `Released: ${order.po_number} rejected`)
        creditsReleased = !releaseError
        if (releaseError) console.error("Purchase Orders PUT: could not release supplier credits", releaseError)
        else await mergeReleasedRemainders(supabase, (reservedRows || []).map((r: any) => r.credit_id), order.po_number)
      }
    }

    return NextResponse.json({
      ...order,
      id: order.po_id.toString(),
      items,
      ...(creditsReleased === undefined ? {} : { creditsReleased }),
    })
  } catch (error) {
    console.error("Purchase Orders PUT: Error", error)
    return NextResponse.json({ error: "Failed to update purchase order" }, { status: 500 })
  }
}

export async function DELETE(request: Request) {
  try {
    const supabase = createAdminClient()

    const { searchParams } = new URL(request.url)
    const poId = parsePositiveId(searchParams.get("id"))

    if (poId === null) {
      return NextResponse.json({ error: "A valid numeric id is required" }, { status: 400 })
    }

    const { data: existing, error: lookupError } = await supabase
      .from("purchase_orders")
      .select("po_id, po_number")
      .eq("po_id", poId)
      .limit(1)
    if (lookupError) throw lookupError
    if (!existing || existing.length === 0) {
      return NextResponse.json({ error: "Purchase order not found" }, { status: 404 })
    }

    // Never delete an order that other records point at (receipts, payables): refuse before touching anything.
    const dependents = await Promise.all([
      supabase.from("goods_receipts").select("receipt_id").eq("po_id", poId).limit(1),
      supabase.from("accounts_payable").select("invoice_id").eq("po_id", poId).limit(1),
    ])
    for (const d of dependents) if (d.error) throw d.error
    if (dependents.some((d) => (d.data || []).length > 0)) {
      return NextResponse.json(
        { error: "This purchase order has goods receipts or payables and cannot be deleted" },
        { status: 409 },
      )
    }

    // Give the order's supplier credits back first. If the delete then fails, they are put back on the PO.
    const { data: reservedRows, error: reservedError } = await supabase
      .from("supplier_credits")
      .select("credit_id")
      .eq("used_in_po_id", poId)
      .eq("status", "used")
    if (reservedError) throw reservedError
    const reservedIds = (reservedRows || []).map((r: any) => r.credit_id)
    const restoreCredits = async () => {
      if (reservedIds.length === 0) return
      const { error: restoreError } = await supabase
        .from("supplier_credits")
        .update({ status: "used", used_in_po_id: poId, used_at: new Date().toISOString() })
        .in("credit_id", reservedIds)
        .eq("status", "active")
      if (restoreError) console.error("Purchase Orders DELETE: could not restore supplier credits", reservedIds, restoreError)
    }
    const releaseError = await releaseSupplierCredits(supabase, poId, `Released: PO #${poId} deleted`)
    if (releaseError) throw new Error(releaseError)
    // An approval may have won in the meantime. If its AP invoice took these credits (a supplier_credit payment),
    // they go back to the PO; if it read them after the release (gross invoice, no credit payment) they stay free.
    const { data: apNow, error: apNowError } = await supabase.from("accounts_payable").select("invoice_id").eq("po_id", poId).limit(1)
    if (apNowError || (apNow || []).length > 0) {
      let applied = true
      if (!apNowError && reservedIds.length > 0) {
        const { data: creditPayments, error: paymentsError } = await supabase
          .from("supplier_payments")
          .select("payment_id")
          .eq("invoice_id", apNow![0].invoice_id)
          .eq("payment_method", SUPPLIER_CREDIT_PAYMENT_METHOD)
          .limit(1)
        applied = !!paymentsError || (creditPayments || []).length > 0
      }
      if (applied) await restoreCredits()
      return NextResponse.json(
        { error: "This purchase order has goods receipts or payables and cannot be deleted" },
        { status: 409 },
      )
    }

    // Delete the order's items, then the order itself
    const { error: itemsError } = await supabase.from("purchase_order_items").delete().eq("po_id", poId)
    if (itemsError) {
      await restoreCredits()
      throw itemsError
    }
    const { error } = await supabase.from("purchase_orders").delete().eq("po_id", poId)
    if (error) {
      await restoreCredits()
      throw error
    }
    await mergeReleasedRemainders(supabase, reservedIds, existing[0].po_number)

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error("Error deleting purchase orders:", error)
    return NextResponse.json({ error: "Failed to delete purchase orders" }, { status: 500 })
  }
}
