import { createAdminClient } from "@/lib/supabase/admin"
import { withRetry } from "@/lib/supabase/rate-limit-handler"
import { NextResponse } from "next/server"

export const dynamic = "force-dynamic"

export async function GET() {
  try {
    console.log("[v0] Sales Orders GET: Starting fetch")

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
        console.log("[v0] Sales Orders GET: No orders found")
        return []
      }

      console.log("[v0] Sales Orders GET: Fetched", ordersData.length, "orders with items")

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
        total: order.net_total || order.total,
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
        items: (order.sales_order_items || []).map((item: any) => ({
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
        })),
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
    console.error("[v0] Sales Orders GET: Failed after all retries", error)
    return NextResponse.json({ error: "Failed to fetch sales orders" }, { status: 500 })
  }
}

export async function POST(request: Request) {
  try {
    console.log("[v0] Sales Orders POST: Starting")
    const supabase = createAdminClient()

    const body = await request.json()
    console.log("[v0] Sales Orders POST: Received body")

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

    const soNumber = soNumberCamel || soNumberSnake
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
        const productIds = inventoryItems.map((item: any) => item.productId)
        const { data: inventoryData, error: inventoryError } = await supabase
          .from("inventory")
          .select("product_id, quantity")
          .in("product_id", productIds)

        if (inventoryError) {
          console.error("[v0] Sales Orders POST: Error fetching inventory", inventoryError)
          return Response.json({ error: "Failed to validate inventory" }, { status: 500 })
        }

        const inventoryMap = new Map<string, number>()
        for (const inv of inventoryData || []) {
          inventoryMap.set(String(inv.product_id), inv.quantity)
        }

        for (const item of inventoryItems) {
          const availableQty = inventoryMap.get(String(item.productId)) || 0
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
        console.log("[v0] Sales Orders POST: Inventory validation passed")
      } else {
        console.log("[v0] Sales Orders POST: No inventory items to validate (all custom/outsourced)")
      }
    }

    console.log("[v0] Sales Orders POST: Payment type:", finalPaymentType)
    console.log("[v0] Sales Orders POST: Payment details:", JSON.stringify(paymentDetails, null, 2))

    let finalPaymentTerms = paymentTerms
    if (!finalPaymentTerms) {
      if (finalPaymentType === "cash") {
        finalPaymentTerms = "prepaid"
      } else if (finalPaymentType === "installments" || finalPaymentType === "hybrid") {
        finalPaymentTerms = "installment"
      } else if (finalPaymentType === "cheque") {
        finalPaymentTerms = "cheque"
      } else {
        finalPaymentTerms = "prepaid"
      }
    }

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
      installments: installments,
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
    
    console.log("[v0] Sales Orders POST - Critical fields:", {
      quotation_request_number: orderData.quotation_request_number,
      department_name: orderData.department_name,
      receiver_name: orderData.receiver_name,
      delivery_contact_name: orderData.delivery_contact_name,
      delivery_contact_phone: orderData.delivery_contact_phone,
      "body.quotation_request_number": body.quotation_request_number,
      "body.department_name": body.department_name,
      "body.receiver_name": body.receiver_name,
    })

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

    console.log("[v0] Sales Orders POST: Inserting order", JSON.stringify(orderData, null, 2))

    const { data: order, error: orderError } = await supabase.from("sales_orders").insert(orderData).select().single()

    if (orderError) {
      console.error("[v0] Sales Orders POST: Error inserting order", orderError)
      throw orderError
    }

    console.log("[v0] Sales Orders POST: Order created", order)

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

      console.log("[v0] Sales Orders POST: Inserting items", itemsWithSoId)

      const { error: itemsError } = await supabase.from("sales_order_items").insert(itemsWithSoId)

      if (itemsError) {
        console.error("[v0] Sales Orders POST: Error inserting items", itemsError)
        throw itemsError
      }

      console.log("[v0] Sales Orders POST: Items inserted successfully")
    }

    if (quotationRequests && quotationRequests.length > 0) {
      const requestsWithOrderId = quotationRequests.map((request: any) => ({
        so_id: order.so_id,
        quotation_request_id: request.quotation_request_id,
        request_date: request.request_date,
        status: request.status,
        requested_by: request.requested_by,
      }))

      console.log("[v0] Sales Orders POST: Inserting quotation requests", requestsWithOrderId)

      const { error: requestsError } = await supabase.from("quotation_requests").insert(requestsWithOrderId)

      if (requestsError) {
        console.error("[v0] Sales Orders POST: Error inserting quotation requests", requestsError)
        throw requestsError
      }

      console.log("[v0] Sales Orders POST: Quotation requests inserted successfully")
    }

    // Create payment schedules if this is an installment order
    if ((finalPaymentType === "installments" || finalPaymentType === "hybrid") && schedule_entries) {
      console.log("[v0] Sales Orders POST: Creating payment schedules for SO", order.so_id)
      
      try {
        const scheduleEntries = typeof schedule_entries === "string" 
          ? JSON.parse(schedule_entries) 
          : schedule_entries
        
        const directSchedules = scheduleEntries.map((entry: any) => ({
          so_id: order.so_id,
          installment_number: entry.installment_number,
          due_date: entry.due_date,
          amount: entry.amount,
          is_down_payment: entry.is_down_payment || false,
          status: "pending",
        }))

        const scheduleResponse = await fetch("http://localhost:3000/api/payment-schedules", {
          method: "POST",
          headers: { 
            "Content-Type": "application/json",
            "x-caller-context": "sales-orders-post",
          },
          body: JSON.stringify({
            soId: order.so_id,
            amount: total,
            directSchedules,
            scheduleMode: "CUSTOM_DATES",
          }),
        })

        if (!scheduleResponse.ok) {
          const scheduleError = await scheduleResponse.json()
          console.error("[v0] Sales Orders POST: Error creating payment schedules", scheduleError)
          // Don't throw - payment schedules can be created manually later
        } else {
          const scheduleData = await scheduleResponse.json()
          console.log("[v0] Sales Orders POST: Payment schedules created successfully", scheduleData)
        }
      } catch (scheduleError) {
        console.error("[v0] Sales Orders POST: Exception creating payment schedules", scheduleError)
        // Don't throw - payment schedules can be created manually later
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
    console.error("[v0] Sales Orders POST: Error", error)
    return NextResponse.json({ error: error.message || "Failed to create sales order" }, { status: 500 })
  }
}

export async function PUT(request: Request) {
  try {
    console.log("[v0] Sales Orders PUT: Starting")
    const supabase = createAdminClient()

    const body = await request.json()
    console.log("[v0] Sales Orders PUT: Received body", body)

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
    
    console.log("[v0] Sales Orders PUT: Using ID", finalId, "from so_id:", so_id, "or id:", id)

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
      if (paymentDetails.installmentMonths !== undefined) dbUpdates.installments = paymentDetails.installmentMonths
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
      console.error("[v0] Sales Orders PUT: No updates to apply for ID:", finalId)
      return NextResponse.json({ error: "No fields to update" }, { status: 400 })
    }

    // Ensure so_id is a number for the query
    const numericId = typeof finalId === "string" ? parseInt(finalId, 10) : finalId
    
    console.log("[v0] Sales Orders PUT: Updating order with numeric ID", numericId, "dbUpdates:", JSON.stringify(dbUpdates))

    const { data: order, error: orderError } = await supabase
      .from("sales_orders")
      .update(dbUpdates)
      .eq("so_id", numericId)
      .select()
      .maybeSingle()

    if (orderError) {
      console.error("[v0] Sales Orders PUT: Error updating order", JSON.stringify(orderError), "ID:", numericId, "Updates:", JSON.stringify(dbUpdates))
      return NextResponse.json({ error: `Database error: ${orderError.message || orderError.code || "Unknown"}` }, { status: 500 })
    }

    if (!order || !order.so_id) {
      console.error("[v0] Sales Orders PUT: No order data returned for ID:", numericId)
      return NextResponse.json({ error: `Sales order ${numericId} not found or update blocked by RLS policy` }, { status: 404 })
    }

    console.log("[v0] Sales Orders PUT: Order updated", order)

    if (items) {
      await supabase.from("sales_order_items").delete().eq("so_id", finalId)

      if (items.length > 0) {
        const itemsWithSoId = items.map((item: any) => ({
          so_id: Number.parseInt(finalId),
          product_id: Number.parseInt(item.productId || item.product_id),
          quantity: item.quantity,
          unit_price: item.unitPrice || item.unit_price,
          total: item.total,
        }))

        await supabase.from("sales_order_items").insert(itemsWithSoId)
      }
    }

    if (quotationRequests) {
      await supabase.from("quotation_requests").delete().eq("so_id", finalId)

      if (quotationRequests.length > 0) {
        const requestsWithOrderId = quotationRequests.map((request: any) => ({
          so_id: Number.parseInt(finalId),
          quotation_request_id: request.quotation_request_id,
          request_date: request.request_date,
          status: request.status,
          requested_by: request.requested_by,
        }))

        await supabase.from("quotation_requests").insert(requestsWithOrderId)
      }
    }

    if (updates.status === "accountant_approved") {
      const { data: currentOrder } = await supabase.from("sales_orders").select("*").eq("so_id", finalId).single()

      if (currentOrder) {
        console.log("[v0] Sales Orders PUT: Processing approved order, payment_type:", currentOrder.payment_type)

        // NOTE: Auto-invoice creation removed.
        // Accountant must manually create invoices through the Accounts Receivable module
        // after delivery permits are approved using "Create from DPs" button.
        console.log("[v0] Sales Orders PUT: Invoice creation deferred to Accountant module")

        const invoiceData: any = {}

        if (paymentType === "cash" || paymentType === "prepaid") {
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
              console.error("[v0] Sales Orders PUT: Error creating down payment invoice", dpError)
            } else {
              console.log("[v0] Sales Orders PUT: Created down payment invoice", dpInvoice)
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
          console.error("[v0] Sales Orders PUT: Error creating AR invoice", invoiceError)
        } else {
          console.log("[v0] Sales Orders PUT: Created AR invoice", newInvoice)
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

      console.log("[v0] Sales Orders PUT: Webhook service loaded, triggering sales_order.approved")
      await webhookService.trigger("sales_order.approved", {
        orderId: order.so_id,
        orderNumber: order.so_number,
        status: order.status,
        total: order.total,
        customerName: customer?.customer_name || "Unknown",
        customerEmail: customer?.email || "",
      })
      console.log("[v0] Sales Orders PUT: Webhook triggered successfully")
    } catch (webhookError) {
      console.error("[v0] Sales Orders PUT: Webhook trigger failed", webhookError)
    }

    // Return success response
    console.log("[v0] Sales Orders PUT: Success for order", numericId)
    return NextResponse.json({ success: true, order })
  } catch (error: any) {
    console.error("[v0] Sales Orders PUT: Error", error)
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
