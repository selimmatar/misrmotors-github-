import { createAdminClient } from "@/lib/supabase/admin"
import { withRetry } from "@/lib/supabase/rate-limit-handler"
import { NextResponse } from "next/server"
import { isSinglePayment, resolveInstallmentCount, toSalesOrderPaymentTerms } from "@/lib/payment-type"
import { DELIVERED_PERMIT_STATUSES, lineKey, loadReturnLines, returnedByKey } from "@/lib/return-lines"
import { loadAvailability } from "@/lib/stock-hold"
import { DP_DELIVERED_STATUSES, lineDeliveryStates } from "@/lib/delivery-status"
import { reopenIfNotFullyDelivered, syncSalesOrderNetTotal, validateSoEdit } from "@/lib/so-edit"

export const dynamic = "force-dynamic"

export async function GET() {
  try {

    const result = await withRetry(async () => {
      const supabase = createAdminClient()

      const { data: ordersData, error: ordersError } = await supabase
        .from("sales_orders")
        .select(`
          *,
          customers:customer_id (customer_name, phone, email),
          sales_order_items (
            *,
            products:product_id (product_name, sku),
            suppliers:supplier_id (supplier_id, supplier_name)
          ),
          delivery_permits (
            permit_id,
            permit_no,
            status,
            created_at
          )
        `)
        .order("created_at", { ascending: false })

      if (ordersError) {
        throw ordersError
      }

      if (!ordersData) {
        return []
      }


      // Batch 2: per-line delivery / return history, so the order can be edited safely after a return.
      const allPermits: any[] = ordersData.flatMap((o: any) => (o.delivery_permits || []).map((dp: any) => ({ ...dp, so_id: o.so_id })))
      const historyByOrder = new Map<number, { delivered: Map<string, number>; confirmed: Map<string, number>; onPermit: Set<string>; returned: Map<string, number> }>()
      if (allPermits.length > 0) {
        try {
          const permitIds = allPermits.map((p) => p.permit_id)
          const { data: dpItems, error: dpItemsError } = await supabase
            .from("delivery_permit_items")
            .select("permit_id, product_id, item_name_snapshot, quantity")
            .in("permit_id", permitIds)
          if (dpItemsError) throw dpItemsError
          const returnLines = await loadReturnLines(supabase, permitIds)
          for (const permit of allPermits) {
            const entry = historyByOrder.get(permit.so_id) || { delivered: new Map(), confirmed: new Map(), onPermit: new Set(), returned: new Map() }
            historyByOrder.set(permit.so_id, entry)
            for (const item of (dpItems || []).filter((i: any) => i.permit_id === permit.permit_id)) {
              const key = lineKey(item.product_id, item.item_name_snapshot)
              entry.onPermit.add(key)
              if (DELIVERED_PERMIT_STATUSES.includes(permit.status)) entry.delivered.set(key, (entry.delivered.get(key) || 0) + (Number(item.quantity) || 0))
              // same permit statuses as isSOFullyDelivered; returns are taken off below
              if (DP_DELIVERED_STATUSES.includes(permit.status)) entry.confirmed.set(key, (entry.confirmed.get(key) || 0) + (Number(item.quantity) || 0))
            }
            for (const [key, qty] of returnedByKey(returnLines, { permitId: permit.permit_id })) {
              entry.returned.set(key, (entry.returned.get(key) || 0) + qty)
              if (DP_DELIVERED_STATUSES.includes(permit.status)) entry.confirmed.set(key, (entry.confirmed.get(key) || 0) - qty)
            }
          }
        } catch (historyError: any) {
          console.error("Sales Orders GET: could not load delivery/return history (editing stays restricted):", historyError?.message)
        }
      }

      const ordersWithItems = ordersData.map((order: any) => ({
        id: order.so_id.toString(),
        soId: order.so_id,
        soNumber: order.so_number,
        customerId: order.customer_id?.toString() || "",
        customerName: order.customers?.customer_name || "",
        customerPhone: order.customers?.phone || "",
        customerEmail: order.customers?.email || "",
        orderDate: order.order_date,
        deliveryDate: order.delivery_date,
        status: order.status,
        paymentTerms: order.payment_terms,
        installments: order.installments,
        subtotal: order.subtotal || order.total,
        discountType: order.discount_type || "none",
        discountValue: order.discount_value || 0,
        discountAmount: order.discount_amount || 0,
        // current (return-aware) total; `grossTotal` is the ordered value of the lines
        total: order.net_total ?? order.total,
        grossTotal: order.total,
        notes: order.notes,
        invoiceFileUrl: order.invoice_file_url,
        createdAt: order.created_at,
        paymentType: order.payment_type || (order.payment_terms === "prepaid" ? "cash" : "installments"),
        scheduleEntries: order.schedule_entries
          ? typeof order.schedule_entries === "string"
            ? JSON.parse(order.schedule_entries)
            : order.schedule_entries
          : null,
        scheduleMode: order.schedule_mode || "AUTO",
        downPaymentDueDate: order.down_payment_due_date,
        paymentDetails: {
          paymentType: order.payment_type || (order.payment_terms === "prepaid" ? "cash" : "installments"),
          installmentMonths: order.installments,
          monthlyAmount: order.monthly_amount,
          chequeNumber: order.cheque_number,
          chequeBankName: order.cheque_bank_name,
          chequeDueDate: order.cheque_due_date,
          chequeAmount: order.cheque_amount,
          chequeNotes: order.cheque_notes,
          downPaymentType: order.down_payment_type,
          downPaymentAmount: order.down_payment_amount,
          downPaymentPercent: order.down_payment_percent,
          remainingAmount: order.remaining_amount,
          remainingInstallmentMonths: order.remaining_installment_months,
          downPaymentChequeNumber: order.down_payment_cheque_number,
          downPaymentChequeBank: order.down_payment_cheque_bank,
          downPaymentChequeDueDate: order.down_payment_cheque_due_date,
          downPaymentDueDate: order.down_payment_due_date,
          paymentStartDate: order.payment_start_date,
        },
        returnedQuantity: [...(historyByOrder.get(order.so_id)?.returned.values() || [])].reduce((a: number, b: number) => a + b, 0),
        items: (order.sales_order_items || []).map((item: any, index: number, all: any[]) => {
          const lineStates = lineDeliveryStates(
            all.map((l: any) => ({ key: lineKey(l.product_id, l.outsourced_name), quantity: Number(l.quantity) || 0 })),
            historyByOrder.get(order.so_id)?.confirmed || new Map(),
          )
          // key-level history is shown on the first line of that item
          const history = historyByOrder.get(order.so_id)
          const key = lineKey(item.product_id, item.outsourced_name)
          const firstOfKey = all.findIndex((other: any) => lineKey(other.product_id, other.outsourced_name) === key) === index
          const deliveredQuantity = firstOfKey ? history?.delivered.get(key) || 0 : 0
          const returnedQuantity = firstOfKey ? history?.returned.get(key) || 0 : 0
          return {
          deliveredQuantity,
          confirmedDeliveredQuantity: lineStates[index].deliveredQuantity,
          deliveryState: lineStates[index].state,
          returnedQuantity,
          minQuantity: firstOfKey ? Math.max(0, deliveredQuantity - returnedQuantity) : 0,
          onDeliveryPermit: !!history?.onPermit.has(key),
          id: item.so_item_id?.toString() || "",
          productId: item.product_id?.toString() || "",
          productName: item.products?.product_name || item.outsourced_name || "",
          outsourcedName: item.outsourced_name || "",
          outsourcedDescription: item.outsourced_description || "",
          outsourcedUnit: item.outsourced_unit || "",
          sku: item.products?.sku || "",
          quantity: item.quantity,
          unitPrice: item.unit_price,
          total: item.total,
          itemType: item.item_type || "stock",
          item_type: item.item_type || "stock",
          itemCategory: item.item_category || "EQUIPMENT",
          supplierId: item.supplier_id?.toString() || "",
          supplierName: item.suppliers?.supplier_name || "",
          fulfilledAt: item.fulfilled_at || null,
          }
        }),
        deliveryPermits: (order.delivery_permits || []).map((dp: any) => ({
          permitId: dp.permit_id,
          permitNumber: dp.permit_no,
          permit_number: dp.permit_no,
          status: dp.status,
          createdAt: dp.created_at,
        })),
        deliveryAddress: order.delivery_address,
        deliveryContactName: order.delivery_contact_name,
        deliveryContactPhone: order.delivery_contact_phone,
        quotationRequests: order.quotation_requests || [],
        quotationRequestNumber: order.quotation_request_number,
        quotationRequestFileName: order.quotation_request_file_name,
        quotationRequestFilePath: order.quotation_request_file_path,
        quotationRequestUploadedAt: order.quotation_request_uploaded_at,
      }))

      return ordersWithItems
    })

    return NextResponse.json(result)
  } catch (error) {
    console.error("Sales Orders GET: Failed after all retries", error)
    return NextResponse.json({ error: "Failed to fetch sales orders" }, { status: 500 })
  }
}

export async function POST(request: Request) {
  try {
    const supabase = createAdminClient()

    const body = await request.json()

    const {
      items,
      orderDate,
      deliveryDate,
      soNumber: soNumberCamel,
      so_number: soNumberSnake,
      customerId,
      customer_id,
      warehouseId,
      warehouse_id,
      order_date,
      delivery_date,
      paymentTerms,
      installments,
      total,
      status,
      notes,
      invoiceFileUrl,
      paymentType,
      payment_type,
      paymentDetails,
      subtotal,
      discountType,
      discount_type,
      discountValue,
      discount_value,
      discountAmount,
      discount_amount,
      deliveryAddress,
      delivery_address,
      deliveryContactName,
      delivery_contact_name,
      deliveryContactPhone,
      delivery_contact_phone,
      schedule_entries,
      schedule_mode,
      down_payment_due_date,
      down_payment_amount,
      down_payment_percent,
      down_payment_type,
      down_payment_cheque_bank,
      down_payment_cheque_number,
      down_payment_cheque_due_date,
      remaining_amount,
      remaining_installment_months,
      monthly_amount,
      payment_start_date,
      quotationRequests,
      quotation_request_number,
      quotation_request_file_name,
      quotation_request_file_path,
      quotation_request_uploaded_at,
      ...rest
    } = body

    // Always generate the SO number server-side (obfuscated, atomic) — never trust a
    // client-supplied value, which was previously a predictable, guessable counter.
    const { data: generatedSoNumber, error: soNumberError } = await supabase.rpc("generate_so_number")
    if (soNumberError || !generatedSoNumber) {
      console.error("Sales Orders POST: Failed to generate SO number", soNumberError)
      return Response.json({ error: "Failed to generate sales order number" }, { status: 500 })
    }
    const soNumber = generatedSoNumber as string
    void soNumberCamel
    void soNumberSnake
    const finalCustomerId = customerId || customer_id
    const rawOrderDate = orderDate || order_date
    // Ensure order_date is never null, undefined, or "unknown" - default to today
    const finalOrderDate = rawOrderDate && rawOrderDate !== "unknown" ? rawOrderDate : new Date().toISOString().split("T")[0]
    const finalDeliveryDate = deliveryDate || delivery_date
    const finalPaymentType = paymentType || payment_type
    const finalDeliveryAddress = deliveryAddress || delivery_address
    const finalDeliveryContactName = deliveryContactName || delivery_contact_name
    const finalDeliveryContactPhone = deliveryContactPhone || delivery_contact_phone

    if (items && items.length > 0) {
      // Filter out items without productId (custom/outsourced items) for inventory validation
      const inventoryItems = items.filter((item: any) => item.productId && item.productId !== "")
      
      if (inventoryItems.length > 0) {
        // Batch 4E-stock: available = on-hand (non-returned stock, all warehouses) - stock held by other approved
        // sales orders that is not yet deducted by an approved delivery permit (lib/stock-hold.ts).
        let availability: Awaited<ReturnType<typeof loadAvailability>>
        try {
          availability = await loadAvailability(
            supabase,
            inventoryItems.map((item: any) => Number(item.productId)),
          )
        } catch (inventoryError) {
          console.error("Sales Orders POST: Error fetching inventory", inventoryError)
          return Response.json({ error: "Failed to validate inventory" }, { status: 500 })
        }

        for (const item of inventoryItems) {
          const availableQty = availability.get(Number(item.productId))?.available || 0
          if (item.quantity > availableQty) {
            console.error(
              `[v0] Sales Orders POST: Insufficient inventory for product ${item.productId}. Requested: ${item.quantity}, Available: ${availableQty}`,
            )
            return Response.json(
              {
                error: `Insufficient inventory for ${item.productName || "product"}. Requested: ${item.quantity}, Available: ${availableQty}`,
              },
              { status: 400 },
            )
          }
        }
      } else {
      }
    }


    // payment_terms only allows 'prepaid' | 'installment' (DB CHECK); cheque is a single payment -> 'prepaid'.
    const finalPaymentTerms = paymentTerms || toSalesOrderPaymentTerms(finalPaymentType)

    const finalWarehouseId = warehouseId || warehouse_id || null
    
    const orderData: any = {
      so_number: soNumber,
      customer_id: finalCustomerId,
      warehouse_id: finalWarehouseId,
      order_date: finalOrderDate,
      delivery_date: finalDeliveryDate,
      delivery_address: finalDeliveryAddress || "",
      delivery_contact_name: finalDeliveryContactName || "",
      delivery_contact_phone: finalDeliveryContactPhone || "",
      payment_terms: finalPaymentTerms,
      // Single-payment types (cash / bank transfer / cheque) always have exactly 1 installment.
      installments: resolveInstallmentCount(finalPaymentType || "cash", installments),
      total: total,
      status: status || "draft",
      notes: notes || "",
      invoice_file_url: invoiceFileUrl || "",
      payment_type: finalPaymentType || "cash",
      subtotal: subtotal || total,
      discount_type: discountType || "none",
      discount_value: discountValue || 0,
      discount_amount: discountAmount || 0,
      net_total: total,
      schedule_entries: schedule_entries
        ? typeof schedule_entries === "string"
          ? schedule_entries
          : JSON.stringify(schedule_entries)
        : null,
      schedule_mode: schedule_mode || "AUTO",
      down_payment_due_date: down_payment_due_date || null,
      quotation_request_number: quotation_request_number || null,
      quotation_request_file_name: quotation_request_file_name || null,
      quotation_request_file_path: quotation_request_file_path || null,
      quotation_request_uploaded_at: quotation_request_uploaded_at || null,
      department_name: body.department_name || null,
      receiver_name: body.receiver_name || null,
    }
    
    if (finalPaymentType === "installments") {
      orderData.installments = paymentDetails?.installmentMonths || installments || 6
      orderData.monthly_amount = paymentDetails?.monthlyAmount || total / (paymentDetails?.installmentMonths || 6)
    } else if (finalPaymentType === "cheque") {
      orderData.cheque_number = paymentDetails?.chequeNumber || ""
      orderData.cheque_bank_name = paymentDetails?.chequeBankName || ""
      orderData.cheque_due_date = paymentDetails?.chequeDueDate || null
      orderData.cheque_amount = paymentDetails?.chequeAmount || total
      orderData.cheque_notes = paymentDetails?.chequeNotes || ""
    } else if (finalPaymentType === "hybrid") {
      orderData.down_payment_type = down_payment_type || paymentDetails?.downPaymentType || "cash"
      orderData.down_payment_amount = down_payment_amount || paymentDetails?.downPaymentAmount || 0
      orderData.down_payment_percent = down_payment_percent || paymentDetails?.downPaymentPercent || 0
      orderData.remaining_amount = remaining_amount || paymentDetails?.remainingAmount || total
      orderData.remaining_installment_months =
        remaining_installment_months || paymentDetails?.remainingInstallmentMonths || 6
      orderData.monthly_amount =
        monthly_amount ||
        paymentDetails?.monthlyAmount ||
        (remaining_amount || paymentDetails?.remainingAmount || total) /
          (remaining_installment_months || paymentDetails?.remainingInstallmentMonths || 6)
      orderData.installments = remaining_installment_months || paymentDetails?.remainingInstallmentMonths || 6
      orderData.down_payment_due_date = down_payment_due_date || paymentDetails?.downPaymentDueDate || null
      orderData.payment_start_date = payment_start_date || paymentDetails?.paymentStartDate || null

      const dpType = down_payment_type || paymentDetails?.downPaymentType
      if (dpType === "cheque") {
        orderData.down_payment_cheque_number =
          down_payment_cheque_number || paymentDetails?.downPaymentChequeNumber || ""
        orderData.down_payment_cheque_bank = down_payment_cheque_bank || paymentDetails?.downPaymentChequeBank || ""
        orderData.down_payment_cheque_due_date =
          down_payment_cheque_due_date || paymentDetails?.downPaymentChequeDueDate || null
      }
    }

    if (paymentDetails && !finalPaymentType) {
      if (paymentDetails.monthlyAmount) orderData.monthly_amount = paymentDetails.monthlyAmount
      if (paymentDetails.chequeNumber) orderData.cheque_number = paymentDetails.chequeNumber
      if (paymentDetails.chequeBankName) orderData.cheque_bank_name = paymentDetails.chequeBankName
      if (paymentDetails.chequeDueDate) orderData.cheque_due_date = paymentDetails.chequeDueDate
      if (paymentDetails.chequeAmount) orderData.cheque_amount = paymentDetails.chequeAmount
      if (paymentDetails.chequeNotes) orderData.cheque_notes = paymentDetails.chequeNotes
      if (paymentDetails.downPaymentType) orderData.down_payment_type = paymentDetails.downPaymentType
      if (paymentDetails.downPaymentAmount) orderData.down_payment_amount = paymentDetails.downPaymentAmount
      if (paymentDetails.downPaymentPercent) orderData.down_payment_percent = paymentDetails.downPaymentPercent
      if (paymentDetails.remainingAmount) orderData.remaining_amount = paymentDetails.remainingAmount
      if (paymentDetails.remainingInstallmentMonths)
        orderData.remaining_installment_months = paymentDetails.remainingInstallmentMonths
      if (paymentDetails.downPaymentChequeNumber)
        orderData.down_payment_cheque_number = paymentDetails.downPaymentChequeNumber
      if (paymentDetails.downPaymentChequeBank)
        orderData.down_payment_cheque_bank = paymentDetails.downPaymentChequeBank
      if (paymentDetails.downPaymentChequeDueDate)
        orderData.down_payment_cheque_due_date = paymentDetails.downPaymentChequeDueDate
    }


    const { data: order, error: orderError } = await supabase.from("sales_orders").insert(orderData).select().single()

    if (orderError) {
      console.error("Sales Orders POST: Error inserting order", orderError)
      throw orderError
    }


    if (items && items.length > 0) {
      const itemsWithSoId = items.map((item: any) => {
        const hasProductId = item.productId && item.productId !== ""
        const isOutsourced = item.itemCategory === "OUTSOURCED" || !hasProductId
        
        // Map item categories - OUTSOURCED is treated as EQUIPMENT
        let validItemCategory = "EQUIPMENT"
        if (item.itemCategory === "MAINTENANCE_PARTS") {
          validItemCategory = "MAINTENANCE_PARTS"
        }
        
        // For outsourced items, combine description with supplier name for internal tracking
        const outsourcedDesc = isOutsourced 
          ? [item.outsourced_description, item.supplier_name ? `Supplier: ${item.supplier_name}` : null]
              .filter(Boolean)
              .join(" | ")
          : null
        
        return {
          so_id: order.so_id,
          product_id: hasProductId ? item.productId : null,
          quantity: item.quantity,
          unit_price: item.unitPrice,
          total: item.total,
          item_type: isOutsourced ? "outsourced" : "stock",
          item_category: validItemCategory,
          outsourced_name: isOutsourced ? item.productName : null,
          outsourced_unit: isOutsourced ? (item.outsourced_unit || "unit") : null,
          outsourced_description: outsourcedDesc,
          supplier_id: item.supplierId ? Number(item.supplierId) : null,
        }
      })


      const { error: itemsError } = await supabase.from("sales_order_items").insert(itemsWithSoId)

      if (itemsError) {
        throw itemsError
      }

    }

    if (quotationRequests && quotationRequests.length > 0) {
      const requestsWithOrderId = quotationRequests.map((request: any) => ({
        so_id: order.so_id,
        quotation_request_id: request.quotation_request_id,
        request_date: request.request_date,
        status: request.status,
        requested_by: request.requested_by,
      }))


      const { error: requestsError } = await supabase.from("quotation_requests").insert(requestsWithOrderId)

      if (requestsError) {
        console.error("Sales Orders POST: Error inserting quotation requests", requestsError)
        throw requestsError
      }

    }

    if (typeof window === "undefined") {
      const { WebhookService } = await import("@/lib/webhook-service")
      const webhookService = WebhookService.getInstance()
      await webhookService.trigger("sales_order.created", {
        orderId: order.so_id,
        orderNumber: order.so_number,
        customerId: order.customer_id,
        customerName: order.customers?.customer_name || "",
        customerPhone: order.customers?.phone || "",
        customerEmail: order.customers?.email || "",
        quotationRequestNumber: order.quotation_request_number,
        departmentName: order.department_name,
        receiverName: order.receiver_name,
        orderDate: order.order_date,
        deliveryDate: order.delivery_date,
        status: order.status,
        paymentType: order.payment_type,
        items: items,
        quotationRequests: quotationRequests,
      })
    }

    return NextResponse.json({ ...order, items, quotationRequests })
  } catch (error: any) {
    console.error("Sales Orders POST: Error", error)
    return NextResponse.json({ error: error.message || "Failed to create sales order" }, { status: 500 })
  }
}

export async function PUT(request: Request) {
  try {
    const supabase = createAdminClient()

    const body = await request.json()

    const {
      id,
      so_id,
      items,
      status,
      paymentType,
      payment_type,
      paymentDetails,
      subtotal,
      discountType,
      discount_type,
      discountValue,
      discount_value,
      discountAmount,
      discount_amount,
      deliveryAddress,
      delivery_address,
      deliveryContactName,
      delivery_contact_name,
      deliveryContactPhone,
      delivery_contact_phone,
      schedule_entries,
      schedule_mode,
      down_payment_due_date,
      down_payment_amount,
      down_payment_percent,
      down_payment_type,
      down_payment_cheque_bank,
      down_payment_cheque_number,
      down_payment_cheque_due_date,
      remaining_amount,
      remaining_installment_months,
      monthly_amount,
      payment_start_date,
      quotationRequests,
      quotation_request_number,
      quotation_request_file_name,
      quotation_request_file_path,
      quotation_request_uploaded_at,
      invoiceFileUrl,
      invoice_file_url,
      notes,
      ...updates
    } = body
    
    const finalId = so_id || id
    const finalInvoiceFileUrl = invoiceFileUrl || invoice_file_url
    

    const finalPaymentType = paymentType || payment_type
    const finalDeliveryAddress = deliveryAddress || delivery_address
    const finalDeliveryContactName = deliveryContactName || delivery_contact_name
    const finalDeliveryContactPhone = deliveryContactPhone || delivery_contact_phone
    const finalDiscountType = discountType || discount_type
    const finalDiscountValue = discountValue || discount_value
    const finalDiscountAmount = discountAmount || discount_amount

    const dbUpdates: any = {}
    if (updates.soNumber || updates.so_number) dbUpdates.so_number = updates.soNumber || updates.so_number
    if (updates.customerId || updates.customer_id) dbUpdates.customer_id = updates.customerId || updates.customer_id
    if (updates.orderDate || updates.order_date) dbUpdates.order_date = updates.orderDate || updates.order_date
    if (updates.deliveryDate || updates.delivery_date)
      dbUpdates.delivery_date = updates.deliveryDate || updates.delivery_date
    if (finalDeliveryAddress) dbUpdates.delivery_address = finalDeliveryAddress
    if (finalDeliveryContactName) dbUpdates.delivery_contact_name = finalDeliveryContactName
    if (finalDeliveryContactPhone) dbUpdates.delivery_contact_phone = finalDeliveryContactPhone
    if (updates.paymentTerms) dbUpdates.payment_terms = updates.paymentTerms
    if (updates.installments !== undefined) dbUpdates.installments = updates.installments
    // A single-payment type (cash / bank transfer / cheque) is always 1 installment, even if the editing
    // form sent its stale default (6).
    if (isSinglePayment(finalPaymentType)) dbUpdates.installments = 1
    if (updates.total !== undefined) dbUpdates.total = updates.total
    if (status) dbUpdates.status = status
    // notes is destructured separately from ...updates, so check the standalone variable
    if (notes !== undefined) dbUpdates.notes = notes
    if (finalInvoiceFileUrl !== undefined) dbUpdates.invoice_file_url = finalInvoiceFileUrl
    if (subtotal !== undefined) dbUpdates.subtotal = subtotal
    if (finalDiscountType) dbUpdates.discount_type = finalDiscountType
    if (finalDiscountValue) dbUpdates.discount_value = finalDiscountValue
    if (finalDiscountAmount) dbUpdates.discount_amount = finalDiscountAmount
    if (updates.total !== undefined) dbUpdates.net_total = updates.total

    if (finalPaymentType) dbUpdates.payment_type = finalPaymentType

    if (paymentDetails) {
      if (paymentDetails.monthlyAmount !== undefined) dbUpdates.monthly_amount = paymentDetails.monthlyAmount
      if (paymentDetails.chequeNumber !== undefined) dbUpdates.cheque_number = paymentDetails.chequeNumber
      if (paymentDetails.chequeBankName !== undefined) dbUpdates.cheque_bank_name = paymentDetails.chequeBankName
      if (paymentDetails.chequeDueDate !== undefined) dbUpdates.cheque_due_date = paymentDetails.chequeDueDate
      if (paymentDetails.chequeAmount !== undefined) dbUpdates.cheque_amount = paymentDetails.chequeAmount
      if (paymentDetails.chequeNotes !== undefined) dbUpdates.cheque_notes = paymentDetails.chequeNotes
      if (paymentDetails.downPaymentType !== undefined) dbUpdates.down_payment_type = paymentDetails.downPaymentType
      if (paymentDetails.downPaymentAmount !== undefined)
        dbUpdates.down_payment_amount = paymentDetails.downPaymentAmount
      if (paymentDetails.downPaymentPercent !== undefined)
        dbUpdates.down_payment_percent = paymentDetails.downPaymentPercent
      if (paymentDetails.remainingAmount !== undefined) dbUpdates.remaining_amount = paymentDetails.remainingAmount
      if (paymentDetails.remainingInstallmentMonths !== undefined)
        dbUpdates.remaining_installment_months = paymentDetails.remainingInstallmentMonths
      if (paymentDetails.downPaymentChequeNumber !== undefined)
        dbUpdates.down_payment_cheque_number = paymentDetails.downPaymentChequeNumber
      if (paymentDetails.downPaymentChequeBank !== undefined)
        dbUpdates.down_payment_cheque_bank = paymentDetails.downPaymentChequeBank
      if (paymentDetails.downPaymentChequeDueDate !== undefined)
        dbUpdates.down_payment_cheque_due_date = paymentDetails.downPaymentChequeDueDate
      if (paymentDetails.installmentMonths !== undefined && !isSinglePayment(finalPaymentType))
        dbUpdates.installments = paymentDetails.installmentMonths
    }

    if (schedule_entries) {
      dbUpdates.schedule_entries =
        typeof schedule_entries === "string" ? schedule_entries : JSON.stringify(schedule_entries)
    }
    if (schedule_mode) {
      dbUpdates.schedule_mode = schedule_mode
    }
    if (down_payment_due_date && !dbUpdates.down_payment_due_date) {
      dbUpdates.down_payment_due_date = down_payment_due_date
    }

    // Only update quotation fields if explicitly provided (don't overwrite with null)
    if (quotation_request_number !== undefined) {
      dbUpdates.quotation_request_number = quotation_request_number || null
    }
    if (quotation_request_file_name !== undefined) {
      dbUpdates.quotation_request_file_name = quotation_request_file_name || null
    }
    if (quotation_request_file_path !== undefined) {
      dbUpdates.quotation_request_file_path = quotation_request_file_path || null
    }
    if (quotation_request_uploaded_at !== undefined) {
      dbUpdates.quotation_request_uploaded_at = quotation_request_uploaded_at || null
    }
    
    if (body.department_name !== undefined) {
      dbUpdates.department_name = body.department_name || null
    }
    if (body.receiver_name !== undefined) {
      dbUpdates.receiver_name = body.receiver_name || null
    }

    // Ensure we have something to update
    if (Object.keys(dbUpdates).length === 0) {
      console.error("Sales Orders PUT: No updates to apply for ID:", finalId)
      return NextResponse.json({ error: "No fields to update" }, { status: 400 })
    }

    // Ensure so_id is a number for the query
    const numericId = typeof finalId === "string" ? parseInt(finalId, 10) : finalId

    // Batch 2: once delivery permits exist (and especially after a return) the order's history must stay intact.
    // Checked BEFORE anything is written so a refused edit changes nothing.
    // The accountant "reject" button sends "rejected", which the status CHECK does not allow: a quotation-type order
    // becomes rejected_quotation, a normal order becomes cancelled (the only red/terminal status the order UI knows).
    if (dbUpdates.status === "rejected") {
      const { data: current } = await supabase.from("sales_orders").select("entity_type").eq("so_id", numericId).limit(1)
      dbUpdates.status = current?.[0]?.entity_type === "quotation" ? "rejected_quotation" : "cancelled"
    }

    const editVerdict = await validateSoEdit(supabase, numericId, { customerId: updates.customerId ?? updates.customer_id, items })
    if (!editVerdict.ok) {
      return NextResponse.json({ error: editVerdict.error }, { status: editVerdict.status })
    }


    const { data: order, error: orderError } = await supabase
      .from("sales_orders")
      .update(dbUpdates)
      .eq("so_id", numericId)
      .select()
      .maybeSingle()

    if (orderError) {
      console.error("Sales Orders PUT: Error updating order", JSON.stringify(orderError), "ID:", numericId, "Updates:", JSON.stringify(dbUpdates))
      return NextResponse.json({ error: `Database error: ${orderError.message || orderError.code || "Unknown"}` }, { status: 500 })
    }

    if (!order || !order.so_id) {
      console.error("Sales Orders PUT: No order data returned for ID:", numericId)
      return NextResponse.json({ error: `Sales order ${numericId} not found or update blocked by RLS policy` }, { status: 404 })
    }


    if (items) {
      // Diff against existing rows instead of delete-all-then-insert-all, so unchanged/edited
      // items keep their so_item_id. Purchase orders can reference an item via
      // source_so_item_id, so reusing the id here keeps that link valid; only items the
      // caller actually removed get deleted.
      const numericSoId = Number.parseInt(finalId)
      const { data: existingItemRows } = await supabase
        .from("sales_order_items")
        .select("so_item_id")
        .eq("so_id", numericSoId)

      const existingIds = new Set((existingItemRows || []).map((row: any) => row.so_item_id))
      const incomingIds = new Set(
        items
          .map((item: any) => item.id ?? item.so_item_id ?? item.soItemId)
          .filter((id: any) => id !== undefined && id !== null && id !== "")
          .map((id: any) => Number(id)),
      )

      const idsToDelete = [...existingIds].filter((id) => !incomingIds.has(id))
      if (idsToDelete.length > 0) {
        await supabase.from("sales_order_items").delete().in("so_item_id", idsToDelete)
      }

      for (const item of items) {
        const hasProductId = (item.productId || item.product_id) && (item.productId || item.product_id) !== ""
        const isOutsourced =
          item.itemCategory === "OUTSOURCED" ||
          item.itemType === "outsourced" ||
          item.item_type === "outsourced" ||
          !hasProductId

        let validItemCategory = "EQUIPMENT"
        if (item.itemCategory === "MAINTENANCE_PARTS" || item.item_category === "MAINTENANCE_PARTS") {
          validItemCategory = "MAINTENANCE_PARTS"
        }

        const supplierName = item.supplierName || item.supplier_name
        const outsourcedDesc = isOutsourced
          ? [item.outsourcedDescription || item.outsourced_description, supplierName ? `Supplier: ${supplierName}` : null]
              .filter(Boolean)
              .join(" | ") || null
          : null

        const itemRow: any = {
          so_id: numericSoId,
          product_id: hasProductId ? Number.parseInt(item.productId || item.product_id) : null,
          quantity: item.quantity,
          unit_price: item.unitPrice ?? item.unit_price,
          total: item.total,
          item_type: isOutsourced ? "outsourced" : "stock",
          item_category: validItemCategory,
          outsourced_name: isOutsourced ? item.productName || item.outsourcedName || item.outsourced_name || null : null,
          outsourced_unit: isOutsourced ? item.outsourcedUnit || item.outsourced_unit || "unit" : null,
          outsourced_description: outsourcedDesc,
          supplier_id: item.supplierId || item.supplier_id ? Number(item.supplierId || item.supplier_id) : null,
        }

        const existingId = item.id ?? item.so_item_id ?? item.soItemId
        if (existingId !== undefined && existingId !== null && existingId !== "" && existingIds.has(Number(existingId))) {
          await supabase.from("sales_order_items").update(itemRow).eq("so_item_id", Number(existingId))
        } else {
          await supabase.from("sales_order_items").insert(itemRow)
        }
      }
    }

    // A replacement line (or a quantity still owed after a return) re-opens an order that was marked delivered.
    if (items) {
      try {
        await reopenIfNotFullyDelivered(supabase, numericId)
      } catch (reopenError: any) {
        console.error("Sales Orders PUT: could not re-open the order after the edit:", reopenError?.message)
      }
    }

    // Keep the current total return-aware after an edit that touched the lines or the total.
    if (items || updates.total !== undefined) {
      try {
        await syncSalesOrderNetTotal(supabase, numericId)
      } catch (syncError: any) {
        console.error("Sales Orders PUT: could not refresh the net total:", syncError?.message)
      }
    }

    if (updates.status === "accountant_approved") {
      const { data: currentOrder } = await supabase.from("sales_orders").select("*").eq("so_id", finalId).single()

      if (currentOrder) {

        // NOTE: Auto-invoice creation removed.
        // Accountant must manually create invoices through the Accounts Receivable module
        // after delivery permits are approved using "Create from DPs" button.

        const invoiceData: any = {}

        if (paymentType === "cash" || paymentType === "prepaid" || paymentType === "bank_transfer") {
          invoiceData.installment_months = 1
          invoiceData.months_paid = 0
          invoiceData.due_date = new Date().toISOString().split("T")[0]
        } else if (paymentType === "installments") {
          invoiceData.installment_months = currentOrder.installments || 6
          invoiceData.months_paid = 0
          const dueDate = new Date()
          dueDate.setMonth(dueDate.getMonth() + 1)
          invoiceData.due_date = dueDate.toISOString().split("T")[0]
        } else if (paymentType === "hybrid") {
          const downPaymentAmount = currentOrder.down_payment_amount || 0
          const remainingAmount = currentOrder.remaining_amount || currentOrder.net_total - downPaymentAmount
          invoiceData.amount = remainingAmount
          invoiceData.installment_months = currentOrder.remaining_installment_months || 6
          invoiceData.months_paid = 0
          const dueDate = new Date()
          dueDate.setMonth(dueDate.getMonth() + 1)
          invoiceData.due_date = dueDate.toISOString().split("T")[0]

          if (downPaymentAmount > 0) {
            const downPaymentInvoiceData = {
              invoice_number: `INV-${currentOrder.so_number}-DP`,
              customer_id: currentOrder.customer_id,
              so_id: currentOrder.so_id,
              invoice_date: new Date().toISOString().split("T")[0],
              due_date: new Date().toISOString().split("T")[0],
              amount: downPaymentAmount,
              collected_amount: 0,
              status: "pending",
              installment_months: 1,
              months_paid: 0,
              payment_terms: "down_payment",
            }

            const { data: dpInvoice, error: dpError } = await supabase
              .from("accounts_receivable")
              .insert(downPaymentInvoiceData)
              .select()
              .single()

            if (dpError) {
              console.error("Sales Orders PUT: Error creating down payment invoice", dpError)
            } else {
            }
          }
        } else if (paymentType === "cheque") {
          invoiceData.installment_months = 1
          invoiceData.months_paid = 0
          invoiceData.due_date = currentOrder.cheque_due_date || new Date().toISOString().split("T")[0]
        }

        const { data: newInvoice, error: invoiceError } = await supabase
          .from("accounts_receivable")
          .insert(invoiceData)
          .select()
          .single()

        if (invoiceError) {
          console.error("Sales Orders PUT: Error creating AR invoice", invoiceError)
        } else {
        }
      }
    }

    // Trigger webhook for accountant_approved status
    try {
      const { WebhookService } = await import("@/lib/webhook-service")
      const webhookService = WebhookService.getInstance()

      const { data: customer } = await supabase
        .from("customers")
        .select("customer_name, email")
        .eq("customer_id", order.customer_id)
        .single()

      await webhookService.trigger("sales_order.approved", {
        orderId: order.so_id,
        orderNumber: order.so_number,
        status: order.status,
        total: order.total,
        customerName: customer?.customer_name || "Unknown",
        customerEmail: customer?.email || "",
      })
    } catch (webhookError) {
      console.error("Sales Orders PUT: Webhook trigger failed", webhookError)
    }

    // Return success response
    return NextResponse.json({ success: true, order })
  } catch (error: any) {
    console.error("Sales Orders PUT: Error", error)
    return NextResponse.json({ error: error.message || "Failed to update sales order" }, { status: 500 })
  }
}

export async function DELETE(request: Request) {
  try {
    const supabase = createAdminClient()

    const { searchParams } = new URL(request.url)
    const id = searchParams.get("id")

    if (id) {
      await supabase.from("sales_order_items").delete().eq("so_id", id)
      await supabase.from("quotation_requests").delete().eq("so_id", id)
      const { error } = await supabase.from("sales_orders").delete().eq("id", id)
      if (error) throw error
    } else {
      await supabase.from("sales_order_items").delete().neq("so_id", "00000000-0000-0000-0000-000000000000")
      await supabase.from("quotation_requests").delete().neq("so_id", "00000000-0000-0000-0000-000000000000")
      const { error } = await supabase.from("sales_orders").delete().neq("id", "00000000-0000-0000-0000-000000000000")
      if (error) throw error
    }

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error("Error deleting sales orders:", error)
    return NextResponse.json({ error: "Failed to delete sales orders" }, { status: 500 })
  }
}
