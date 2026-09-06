import { createAdminClient } from "@/lib/supabase/admin"
import { withRetry } from "@/lib/supabase/rate-limit-handler"
import { NextResponse } from "next/server"

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
                : item.products?.product_name || item.product_name || "Unknown Product",
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

    let scheduleEntriesValue = null
    if (orderData.schedule_entries) {
      scheduleEntriesValue =
        typeof orderData.schedule_entries === "string"
          ? orderData.schedule_entries
          : JSON.stringify(orderData.schedule_entries)
    }

    const orderWithCurrency = {
      po_number: orderData.po_number || orderData.poNumber,
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
      const itemsWithPoId = items.map((item: any) => {
        const itemType = item.itemType || item.item_type || "stock"
        const isOutsourced = itemType === "outsourced"
        const rawProductId = item.productId || item.product_id
        return {
          po_id: order.po_id,
          // Outsourced items have no product; keep product_id null
          product_id: isOutsourced ? null : rawProductId || null,
          quantity: Number(item.quantity) || 0,
          unit_price: Number(item.unitPrice ?? item.unit_price ?? 0),
          total: Number(item.total ?? 0),
          item_type: itemType,
          outsourced_name: item.outsourcedName || item.outsourced_name || null,
          outsourced_description: item.outsourcedDescription || item.outsourced_description || null,
          outsourced_unit: item.outsourcedUnit || item.outsourced_unit || null,
          source_so_id: item.sourceSoId || item.source_so_id || null,
          source_so_item_id: item.sourceSoItemId || item.source_so_item_id || null,
        }
      })

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

    let scheduleEntriesValue = null
    if (updates.schedule_entries) {
      scheduleEntriesValue =
        typeof updates.schedule_entries === "string"
          ? updates.schedule_entries
          : JSON.stringify(updates.schedule_entries)
    }

    updates.schedule_entries = scheduleEntriesValue

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

    const { data: order, error: orderError } = await supabase
      .from("purchase_orders")
      .update(updates)
      .eq("po_id", id)
      .select()
      .single()

    if (orderError || !order) {
      console.error("Purchase Orders PUT: Error updating order", orderError)
      return NextResponse.json({ error: orderError?.message || "Failed to update purchase order" }, { status: 500 })
    }


    if (items) {
      await supabase.from("purchase_order_items").delete().eq("po_id", id)

      if (items.length > 0) {
        const itemsWithPoId = items.map((item: any) => ({
          po_id: Number.parseInt(id),
          product_id: Number.parseInt(item.product_id || item.productId),
          quantity: item.quantity,
          unit_price: item.unit_price || item.unitPrice,
          total: item.total,
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

    if (updates.status === "approved") {
      const { data: currentOrder } = await supabase.from("purchase_orders").select("*").eq("po_id", id).single()

      if (currentOrder) {
        // Dedup check: only create AP entry if one doesn't already exist for this PO
        const { data: existingInvoice } = await supabase
          .from("accounts_payable")
          .select("invoice_id")
          .eq("po_id", id)
          .maybeSingle()

        if (!existingInvoice) {
          const paymentType = currentOrder.payment_type || currentOrder.payment_terms || "cash"
          const isPrepaidOrCash = paymentType === "prepaid" || paymentType === "cash"

          const invoiceData: any = {
            invoice_number: `APINV-${currentOrder.po_number}`,
            supplier_id: currentOrder.supplier_id,
            po_id: currentOrder.po_id,
            invoice_date: new Date().toISOString().split("T")[0],
            due_date: currentOrder.down_payment_due_date || currentOrder.payment_start_date || new Date().toISOString().split("T")[0],
            amount: currentOrder.total,
            paid_amount: 0,
            status: isPrepaidOrCash ? "paid" : "pending",
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

          const { data: newInvoice, error: invoiceError } = await supabase
            .from("accounts_payable")
            .insert(invoiceData)
            .select()
            .single()

          if (invoiceError) {
            console.error("Purchase Orders PUT: Error creating AP invoice on approval", invoiceError)
          } else if (isPrepaidOrCash && newInvoice) {
            // For prepaid/cash: also create supplier payment and balance entry
            await supabase.from("supplier_payments").insert({
              supplier_invoice_id: newInvoice.invoice_id,
              supplier_id: currentOrder.supplier_id,
              amount: currentOrder.total,
              payment_date: new Date().toISOString().split("T")[0],
              payment_method: paymentType,
              reference_number: `${paymentType.toUpperCase()}-${currentOrder.po_number}`,
              status: "completed",
            })

            await (supabase as any).from("balance_entries").insert({
              entry_type: "ap_payment",
              reference_type: "purchase_order",
              reference_id: currentOrder.po_id.toString(),
              reference_number: currentOrder.po_number,
              amount: -currentOrder.total,
              description: `${paymentType} payment for ${currentOrder.po_number}`,
              status: "active",
            })
          }
        }
      }
    }

    if (updates.status === "approved" && typeof window === "undefined") {
      const { WebhookService } = await import("@/lib/webhook-service")
      const webhookService = WebhookService.getInstance()
      await webhookService.trigger("purchase_order.approved", {
        orderId: order.po_id,
        orderNumber: order.po_number,
        status: order.status,
        total: order.total,
      })
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
    const id = searchParams.get("id")

    if (id) {
      // Delete single order and its items
      await supabase.from("purchase_order_items").delete().eq("po_id", id)
      const { error } = await supabase.from("purchase_orders").delete().eq("id", id)
      if (error) throw error
    } else {
      // Delete all orders (for reset)
      await supabase.from("purchase_order_items").delete().neq("po_id", "00000000-0000-0000-0000-000000000000")
      const { error } = await supabase
        .from("purchase_orders")
        .delete()
        .neq("id", "00000000-0000-0000-0000-000000000000")
      if (error) throw error
    }

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error("Error deleting purchase orders:", error)
    return NextResponse.json({ error: "Failed to delete purchase orders" }, { status: 500 })
  }
}
