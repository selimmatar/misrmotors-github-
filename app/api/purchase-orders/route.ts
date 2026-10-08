import { createAdminClient } from "@/lib/supabase/admin"
import { parsePositiveId } from "@/lib/parse-id"
import { withRetry } from "@/lib/supabase/rate-limit-handler"
import { NextResponse } from "next/server"
import { isAllowedPoTransition, PO_ITEMS_EDITABLE_STATUSES, buildApprovalRevert } from "@/lib/po-status"
import { checkPoOverOrder, linesWithIncreasedQuantity } from "@/lib/po-over-order"

// Shared by POST and PUT so editing a PO's items keeps the SO link and the outsourced data.
// `existingItems` (PUT only) are the PO's current rows: a line sent without item_type keeps its existing type
// instead of silently becoming 'stock'. Only genuinely new lines default to 'stock'.
function findExistingPoItem(item: any, existingItems: any[]) {
  const id = Number.parseInt(item.id ?? item.poItemId ?? item.po_item_id)
  if (Number.isFinite(id)) {
    const byId = existingItems.find((e) => e.po_item_id === id)
    if (byId) return byId
  }
  const sourceItemId = Number.parseInt(item.sourceSoItemId || item.source_so_item_id)
  if (Number.isFinite(sourceItemId)) {
    const bySource = existingItems.find((e) => e.source_so_item_id === sourceItemId)
    if (bySource) return bySource
  }
  const name = String(item.outsourcedName || item.outsourced_name || "").trim().toLowerCase()
  if (name) return existingItems.find((e) => String(e.outsourced_name || "").trim().toLowerCase() === name)
  return undefined
}

function mapPoItem(item: any, poId: number, existingItems: any[] = []) {
  const itemType = item.itemType || item.item_type || findExistingPoItem(item, existingItems)?.item_type || "stock"
  const isOutsourced = itemType === "outsourced"
  const rawProductId = item.productId || item.product_id
  return {
    po_id: poId,
    // Outsourced items have no product; keep product_id null
    product_id: isOutsourced ? null : rawProductId || null,
    // Keep the display name so free-text items (no product_id) still print on invoices
    item_name_snapshot: item.productName || item.product_name || null,
    quantity: Number(item.quantity) || 0,
    unit_price: Number(item.unitPrice ?? item.unit_price ?? 0),
    total: Number(item.total ?? 0),
    item_type: itemType,
    outsourced_name: item.outsourcedName || item.outsourced_name || null,
    outsourced_description: item.outsourcedDescription || item.outsourced_description || null,
    outsourced_unit: item.outsourcedUnit || item.outsourced_unit || null,
    // The client sends these as strings; the columns are integers.
    source_so_id: Number.parseInt(item.sourceSoId || item.source_so_id) || null,
    source_so_item_id: Number.parseInt(item.sourceSoItemId || item.source_so_item_id) || null,
  }
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
                ? item.outsourced_name || "Outsourced Item"
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
    const { items, ...orderData } = body

    // Do not order more from suppliers than the sales order lines need (400/409 before anything is written).
    // Known limit: two concurrent POSTs can still both pass; closing that needs a DB constraint (not approved).
    const overOrder = await checkPoOverOrder(supabase, items)
    if (!overOrder.ok) {
      return NextResponse.json(
        { error: overOrder.error, code: overOrder.code, lines: overOrder.lines },
        { status: overOrder.status },
      )
    }

    let scheduleEntriesValue = null
    if (orderData.schedule_entries) {
      scheduleEntriesValue =
        typeof orderData.schedule_entries === "string"
          ? orderData.schedule_entries
          : JSON.stringify(orderData.schedule_entries)
    }

    // Always generate the PO number server-side (obfuscated, atomic) — never trust a
    // client-supplied value, which was previously a predictable, guessable counter.
    const { data: generatedPoNumber, error: poNumberError } = await supabase.rpc("generate_po_number")
    if (poNumberError || !generatedPoNumber) {
      console.error("Purchase Orders POST: Failed to generate PO number", poNumberError)
      return NextResponse.json({ error: "Failed to generate purchase order number" }, { status: 500 })
    }

    const orderWithCurrency = {
      po_number: generatedPoNumber as string,
      supplier_id: orderData.supplier_id || orderData.supplierId,
      order_date: orderData.order_date || orderData.orderDate,
      delivery_date: orderData.delivery_date || orderData.deliveryDate,
      payment_terms: orderData.payment_terms || orderData.paymentTerms,
      installments: orderData.installments,
      status: orderData.status,
      total: orderData.total,
      currency: orderData.currency || "EGP",
      po_type: orderData.po_type || orderData.poType || "local",
      invoice_file_url: orderData.invoice_file_url || orderData.invoiceFileUrl || orderData.poInvoiceUrl || null,
      rejection_reason: orderData.rejection_reason || orderData.rejectionReason || null,
      rejected_by: orderData.rejected_by || orderData.rejectedBy || null,
      rejected_at: orderData.rejected_at || orderData.rejectedAt || null,
      approved_by: orderData.approved_by || orderData.approvedBy || null,
      approved_at: orderData.approved_at || orderData.approvedAt || null,
      created_by: orderData.created_by || orderData.createdBy || null,
      tax_amount: orderData.tax_amount || orderData.taxAmount || null,
      other_costs: orderData.other_costs || orderData.otherCosts || null,
      cost_finalized: orderData.cost_finalized || orderData.costFinalized || null,
      cost_finalized_at: orderData.cost_finalized_at || orderData.costFinalizedAt || null,
      cost_finalized_by: orderData.cost_finalized_by || orderData.costFinalizedBy || null,
      payment_type:
        orderData.payment_type || orderData.paymentType || orderData.payment_terms || orderData.paymentTerms,
      down_payment_amount: orderData.down_payment_amount || orderData.downPaymentAmount || null,
      down_payment_percent: orderData.down_payment_percent || orderData.downPaymentPercent || null,
      down_payment_type: orderData.down_payment_type || orderData.downPaymentType || null,
      down_payment_cheque_bank: orderData.down_payment_cheque_bank || orderData.downPaymentChequeBank || null,
      down_payment_cheque_number: orderData.down_payment_cheque_number || orderData.downPaymentChequeNumber || null,
      down_payment_cheque_due_date:
        orderData.down_payment_cheque_due_date || orderData.downPaymentChequeDueDate || null,
      cheque_number:
        orderData.cheque_number || orderData.chequeNumber || orderData.paymentDetails?.chequeNumber || null,
      cheque_bank_name:
        orderData.cheque_bank_name || orderData.chequeBankName || orderData.paymentDetails?.chequeBankName || null,
      cheque_due_date:
        orderData.cheque_due_date || orderData.chequeDueDate || orderData.paymentDetails?.chequeDueDate || null,
      cheque_amount:
        orderData.cheque_amount || orderData.chequeAmount || orderData.paymentDetails?.chequeAmount || null,
      cheque_notes:
        orderData.cheque_notes || orderData.chequeNotes || orderData.paymentDetails?.chequeNotes || null,
      down_payment_due_date: orderData.down_payment_due_date || orderData.downPaymentDueDate || null,
      remaining_amount: orderData.remaining_amount || orderData.remainingAmount || null,
      remaining_installment_months:
        orderData.remaining_installment_months || orderData.remainingInstallmentMonths || null,
      monthly_amount: orderData.monthly_amount || orderData.monthlyAmount || null,
      payment_start_date: orderData.payment_start_date || orderData.paymentStartDate || null,
      schedule_entries: scheduleEntriesValue,
      schedule_mode: orderData.schedule_mode || orderData.scheduleMode || "AUTO",
      bank_name: orderData.bank_name || orderData.bankName || null,
      bank_account_number: orderData.bank_account_number || orderData.bankAccountNumber || null,
      bank_swift_code: orderData.bank_swift_code || orderData.bankSwiftCode || null,
      bank_iban: orderData.bank_iban || orderData.bankIban || null,
      bank_branch: orderData.bank_branch || orderData.bankBranch || null,
      bank_holder_name: orderData.bank_holder_name || orderData.bankHolderName || null,
    }


    const { data: order, error: orderError } = await supabase
      .from("purchase_orders")
      .insert(orderWithCurrency)
      .select()
      .single()

    if (orderError) {
      console.error("Purchase Orders POST: Error inserting order", orderError)
      throw orderError
    }


    // Insert items if provided
    if (items && items.length > 0) {
      const itemsWithPoId = items.map((item: any) => mapPoItem(item, order.po_id))

      const { error: itemsInsertError } = await supabase.from("purchase_order_items").insert(itemsWithPoId)

      if (itemsInsertError) {
        console.error("Purchase Orders POST: Error inserting items", itemsInsertError)
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
    }

    return NextResponse.json(createdOrder)
  } catch (error) {
    console.error("Purchase Orders POST: Error", error)
    return NextResponse.json({ error: "Failed to create purchase order" }, { status: 500 })
  }
}

// Creates the AP invoice for an approved PO unless one already exists. Returns the error, or null when the invoice
// exists afterwards. Payment is a separate explicit step (POST /api/accounts-payable/payments).
async function ensureApInvoice(supabase: any, currentOrder: any) {
  // limit(1) rather than maybeSingle(): a PO with duplicate AP rows (historical data) must not error here.
  const { data: existingInvoices, error: lookupError } = await supabase
    .from("accounts_payable")
    .select("invoice_id")
    .eq("po_id", currentOrder.po_id)
    .limit(1)
  if (lookupError) return lookupError
  if (existingInvoices && existingInvoices.length > 0) return null

  const paymentType = currentOrder.payment_type || currentOrder.payment_terms || "cash"
  const invoiceData: any = {
    invoice_number: `APINV-${currentOrder.po_number}`,
    supplier_id: currentOrder.supplier_id,
    po_id: currentOrder.po_id,
    invoice_date: new Date().toISOString().split("T")[0],
    due_date: currentOrder.down_payment_due_date || currentOrder.payment_start_date || new Date().toISOString().split("T")[0],
    amount: currentOrder.total,
    paid_amount: 0,
    status: "pending",
    payment_type: paymentType,
    payment_terms: paymentType,
    installment_months: currentOrder.installments || 1,
    months_paid: 0,
    down_payment_amount: currentOrder.down_payment_amount || null,
    down_payment_percent: currentOrder.down_payment_percent || null,
    down_payment_type: currentOrder.down_payment_type || null,
    down_payment_due_date: currentOrder.down_payment_due_date || null,
    remaining_amount: currentOrder.remaining_amount || null,
    remaining_installment_months: currentOrder.remaining_installment_months || null,
    monthly_amount: currentOrder.monthly_amount || null,
    payment_start_date: currentOrder.payment_start_date || null,
    schedule_entries: currentOrder.schedule_entries || null,
    schedule_mode: currentOrder.schedule_mode || "AUTO",
  }
  const { error: invoiceError } = await supabase.from("accounts_payable").insert(invoiceData).select().single()
  return invoiceError || null
}

export async function PUT(request: Request) {
  try {
    const supabase = createAdminClient()

    const body = await request.json()
    const { id, items, ...updates } = body

    if (updates.poInvoiceUrl !== undefined) {
      updates.invoice_file_url = updates.poInvoiceUrl
      delete updates.poInvoiceUrl
    }

    if (updates.rejectionReason !== undefined) {
      updates.rejection_reason = updates.rejectionReason
      delete updates.rejectionReason
    }

    if (updates.rejectedBy !== undefined) {
      updates.rejected_by = updates.rejectedBy
      delete updates.rejectedBy
    }

    if (updates.rejectedAt !== undefined) {
      updates.rejected_at = updates.rejectedAt
      delete updates.rejectedAt
    }

    if (updates.approvedBy !== undefined) {
      updates.approved_by = updates.approvedBy
      delete updates.approvedBy
    }

    if (updates.approvedAt !== undefined) {
      updates.approved_at = updates.approvedAt
      delete updates.approvedAt
    }

    if (updates.createdBy !== undefined) {
      updates.created_by = updates.createdBy
      delete updates.createdBy
    }

    if (updates.createdAt !== undefined) {
      delete updates.createdAt
    }

    if (updates.updatedAt !== undefined) {
      delete updates.updatedAt
    }

    if (updates.taxAmount !== undefined) {
      updates.tax_amount = updates.taxAmount
      delete updates.taxAmount
    }

    if (updates.otherCosts !== undefined) {
      updates.other_costs = updates.otherCosts
      delete updates.otherCosts
    }

    if (updates.costFinalized !== undefined) {
      updates.cost_finalized = updates.costFinalized
      delete updates.costFinalized
    }

    if (updates.costFinalizedAt !== undefined) {
      updates.cost_finalized_at = updates.costFinalizedAt
      delete updates.costFinalizedAt
    }

    if (updates.costFinalizedBy !== undefined) {
      updates.cost_finalized_by = updates.costFinalizedBy
      delete updates.costFinalizedBy
    }

    if (updates.notes !== undefined) {
      delete updates.notes
    }

    if (updates.paymentType !== undefined) {
      updates.payment_type = updates.paymentType
      delete updates.paymentType
    }

    if (updates.downPaymentAmount !== undefined) {
      updates.down_payment_amount = updates.downPaymentAmount
      delete updates.downPaymentAmount
    }

    if (updates.downPaymentPercent !== undefined) {
      updates.down_payment_percent = updates.downPaymentPercent
      delete updates.downPaymentPercent
    }

    if (updates.downPaymentType !== undefined) {
      updates.down_payment_type = updates.downPaymentType
      delete updates.downPaymentType
    }

    if (updates.downPaymentChequeBank !== undefined) {
      updates.down_payment_cheque_bank = updates.downPaymentChequeBank
      delete updates.downPaymentChequeBank
    }

    if (updates.downPaymentChequeNumber !== undefined) {
      updates.down_payment_cheque_number = updates.downPaymentChequeNumber
      delete updates.downPaymentChequeNumber
    }

    if (updates.downPaymentChequeDueDate !== undefined) {
      updates.down_payment_cheque_due_date = updates.downPaymentChequeDueDate
      delete updates.downPaymentChequeDueDate
    }

    if (updates.downPaymentDueDate !== undefined) {
      updates.down_payment_due_date = updates.downPaymentDueDate
      delete updates.downPaymentDueDate
    }

    if (updates.remainingAmount !== undefined) {
      updates.remaining_amount = updates.remainingAmount
      delete updates.remainingAmount
    }

    if (updates.remainingInstallmentMonths !== undefined) {
      updates.remaining_installment_months = updates.remainingInstallmentMonths
      delete updates.remainingInstallmentMonths
    }

    if (updates.monthlyAmount !== undefined) {
      updates.monthly_amount = updates.monthlyAmount
      delete updates.monthlyAmount
    }

    if (updates.paymentStartDate !== undefined) {
      updates.payment_start_date = updates.paymentStartDate
      delete updates.paymentStartDate
    }

    // Only touch schedule_entries when the caller sent it (an approve/reject must not wipe it).
    if (updates.schedule_entries !== undefined) {
      updates.schedule_entries = updates.schedule_entries
        ? typeof updates.schedule_entries === "string"
          ? updates.schedule_entries
          : JSON.stringify(updates.schedule_entries)
        : null
    }

    // Add bank details fields to updates
    if (updates.bankName !== undefined) {
      updates.bank_name = updates.bankName
      delete updates.bankName
    }

    if (updates.bankAccountNumber !== undefined) {
      updates.bank_account_number = updates.bankAccountNumber
      delete updates.bankAccountNumber
    }

    if (updates.bankSwiftCode !== undefined) {
      updates.bank_swift_code = updates.bankSwiftCode
      delete updates.bankSwiftCode
    }

    if (updates.bankIban !== undefined) {
      updates.bank_iban = updates.bankIban
      delete updates.bankIban
    }

    if (updates.bankBranch !== undefined) {
      updates.bank_branch = updates.bankBranch
      delete updates.bankBranch
    }

    if (updates.bankHolderName !== undefined) {
      updates.bank_holder_name = updates.bankHolderName
      delete updates.bankHolderName
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
      if (!overOrder.ok) {
        return NextResponse.json(
          { error: overOrder.error, code: overOrder.code, lines: overOrder.lines },
          { status: overOrder.status },
        )
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

    if (items) {
      // Read the current rows first so lines without an item_type keep theirs (see mapPoItem).
      const { data: existingRows, error: existingError } = await supabase
        .from("purchase_order_items")
        .select("po_item_id, item_type, source_so_item_id, outsourced_name")
        .eq("po_id", poId)
      if (existingError) {
        console.error("Purchase Orders PUT: Error reading existing items", existingError)
        throw existingError
      }
      const existingItems = (existingRows || []) as any[]
      await supabase.from("purchase_order_items").delete().eq("po_id", poId)

      if (items.length > 0) {
        const itemsWithPoId = items.map((item: any) => ({
          ...mapPoItem(item, poId, existingItems),
          allocated_tax: item.allocatedTax || item.allocated_tax,
          allocated_overhead: item.allocatedOverhead || item.allocated_overhead,
          landed_cost: item.landedCost || item.landed_cost,
        }))

        const { error: itemsError } = await supabase.from("purchase_order_items").insert(itemsWithPoId)

        if (itemsError) {
          console.error("Purchase Orders PUT: Error updating items", itemsError)
          throw itemsError
        }

      }
    }

    // A repeat approval of an already approved PO repairs a missing AP invoice, except while the original
    // approval (which owns the AP insert and a possible revert) is still in flight.
    const approvalInFlight =
      !approving && current.approved_at && Date.now() - new Date(current.approved_at).getTime() < 30_000
    if (targetStatus === "approved" && !approvalInFlight) {
      const apError = await ensureApInvoice(supabase, order)

      if (apError) {
        console.error("Purchase Orders PUT: Error creating AP invoice on approval", apError)
        let reverted = false
        if (approving) {
          // Put the PO back to pending so the failure is real to the user and the approval can simply be retried.
          const { data: revertedRows, error: revertError } = await supabase
            .from("purchase_orders")
            .update(buildApprovalRevert(current, updates))
            .eq("po_id", poId)
            .eq("status", "approved")
            .select("po_id")
          reverted = !revertError && Array.isArray(revertedRows) && revertedRows.length > 0
          if (!reverted) console.error("Purchase Orders PUT: could not revert approval after AP failure", revertError)
        }
        return NextResponse.json(
          reverted
            ? {
                error: "The AP invoice could not be created, so the purchase order was NOT approved. Please try again.",
                poApproved: false,
                apInvoiceCreated: false,
              }
            : {
                error: "The purchase order is approved but its AP invoice could not be created. Contact an administrator.",
                poApproved: true,
                apInvoiceCreated: false,
              },
          { status: 500 },
        )
      }

      // Notify only on the first successful approval; a notification failure must not fail a committed approval.
      if (approving && typeof window === "undefined") {
        try {
          const { WebhookService } = await import("@/lib/webhook-service")
          const webhookService = WebhookService.getInstance()
          await webhookService.trigger("purchase_order.approved", {
            orderId: order.po_id,
            orderNumber: order.po_number,
            status: order.status,
            total: order.total,
          })
        } catch (webhookError) {
          console.error("Purchase Orders PUT: purchase_order.approved webhook failed", webhookError)
        }
      }
    }

    return NextResponse.json({ ...order, id: order.po_id.toString(), items })
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
      .select("po_id")
      .eq("po_id", poId)
      .limit(1)
    if (lookupError) throw lookupError
    if (!existing || existing.length === 0) {
      return NextResponse.json({ error: "Purchase order not found" }, { status: 404 })
    }

    // Delete the order's items, then the order itself
    const { error: itemsError } = await supabase.from("purchase_order_items").delete().eq("po_id", poId)
    if (itemsError) throw itemsError
    const { error } = await supabase.from("purchase_orders").delete().eq("po_id", poId)
    if (error) throw error

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error("Error deleting purchase orders:", error)
    return NextResponse.json({ error: "Failed to delete purchase orders" }, { status: 500 })
  }
}
