import { type NextRequest, NextResponse } from "next/server"
import { createAdminClient } from "@/lib/supabase/admin"
import { withRetry } from "@/lib/supabase/rate-limit-handler"
import { checkIdempotency, completeIdempotency, generateDPApprovalIdempotencyKey } from "@/lib/idempotency"
import { lineKey, loadReturnLines, netLineQuantities, returnedByKey, returnedTotalsByPermit } from "@/lib/return-lines"
import { isSOFullyDelivered } from "@/lib/delivery-status"
import { isAllowedDpTransition } from "@/lib/dp-transitions"
import { abortDeduction, deductStockForPermit, finishDeduction, type StockMove } from "@/lib/dp-stock"

export const dynamic = "force-dynamic"

// GET - Fetch all delivery permits or a specific one
export async function GET(request: NextRequest) {
  try {
    const supabase = createAdminClient()
    const { searchParams } = new URL(request.url)
    const permitId = searchParams.get("id")
    const soId = searchParams.get("soId") || searchParams.get("so_id")
    const status = searchParams.get("status")

    let query = supabase.from("delivery_permits").select(`
        *,
        sales_orders (
          so_number,
          total,
          order_date,
          delivery_date,
          status,
          fulfillment_status,
          payment_active,
          delivery_address,
          delivery_contact_name,
          delivery_contact_phone,
          quotation_request_number,
          quotation_request_file_name,
          quotation_request_file_path,
          quotation_request_uploaded_at
        ),
        customers (
          customer_name,
          phone,
          address,
          city,
          country
        )
      `)

    if (permitId) {
      query = query.eq("permit_id", permitId)
    }

    if (soId) {
      query = query.eq("sales_order_id", soId)
    }

    if (status) {
      query = query.eq("status", status)
    }

    let permits, error
    try {
      const result = await query.order("created_at", { ascending: false })
      permits = result.data
      error = result.error
    } catch (parseError: any) {
      if (parseError.message?.includes("JSON Parse") || parseError.message?.includes("Unexpected identifier")) {
        console.error("Delivery Permits GET error: Rate limited (JSON parse failed):", parseError.message)
        return NextResponse.json(
          { error: "Service temporarily unavailable - too many requests", code: "RATE_LIMITED" },
          { status: 503 },
        )
      }
      throw parseError
    }

    if (error) {
      if (error.code === "PGRST205" || error.message?.includes("Could not find the table")) {
        console.log(
          "[v0] Delivery Permits table not found - returning empty array. Run migration script 032_create_delivery_permits.sql",
        )
        return NextResponse.json([])
      }
      console.error("Delivery Permits GET error:", error.message)
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    const permitIds = (permits || []).map((p: any) => p.permit_id)

    const [itemsResult, filesResult] = await Promise.all([
      permitIds.length > 0
        ? withRetry(() => supabase.from("delivery_permit_items").select("*, suppliers:supplier_id (supplier_id, supplier_name)").in("permit_id", permitIds))
        : Promise.resolve({ data: [] }),
      permitIds.length > 0
        ? withRetry(() => supabase.from("delivery_permit_files").select("*").in("permit_id", permitIds))
        : Promise.resolve({ data: [] }),
    ])

    // Group items and files by permit_id
    const itemsByPermit = (itemsResult.data || []).reduce((acc: any, item: any) => {
      const pid = item.permit_id
      if (!acc[pid]) acc[pid] = []
      acc[pid].push(item)
      return acc
    }, {})

    const filesByPermit = (filesResult.data || []).reduce((acc: any, file: any) => {
      const pid = file.permit_id
      if (!acc[pid]) acc[pid] = []
      acc[pid].push(file)
      return acc
    }, {})

    // Map permits with their items and files
    const permitsWithItems = (permits || []).map((permit: any) => {
      const items = itemsByPermit[permit.permit_id] || []
      const files = filesByPermit[permit.permit_id] || []

      return {
        id: permit.permit_id.toString(),
        permitNo: permit.permit_no,
        salesOrderId: permit.sales_order_id?.toString(),
        soNumber: permit.sales_orders?.so_number,
        soTotal: permit.sales_orders?.total,
        soStatus: permit.sales_orders?.status,
        fulfillmentStatus: permit.sales_orders?.fulfillment_status,
        paymentActive: permit.sales_orders?.payment_active,
        customerId: permit.customer_id?.toString(),
        customerName: permit.customers?.customer_name,
        customerPhone: permit.customers?.phone,
        customerAddress: permit.customers?.address,
        customerCity: permit.customers?.city,
        customerCountry: permit.customers?.country,
        invoiceId: permit.invoice_id ? permit.invoice_id.toString() : null,
        recipientName: permit.recipient_name || permit.sales_orders?.delivery_contact_name || permit.customers?.customer_name,
        recipientPhone: permit.recipient_phone || permit.sales_orders?.delivery_contact_phone || permit.customers?.phone,
        deliveryAddress: permit.delivery_address || permit.sales_orders?.delivery_address || permit.customers?.address,
        driverName: permit.driver_name,
        courierId: permit.courier_id?.toString(),
        status: permit.status,
        rejectionReason: permit.rejection_reason,
        printedAt: permit.printed_at,
        printedBy: permit.printed_by,
        outForDeliveryAt: permit.out_for_delivery_at,
        outForDeliveryBy: permit.out_for_delivery_by,
        submittedSignedAt: permit.submitted_signed_at,
        submittedSignedBy: permit.submitted_signed_by,
        approvedAt: permit.approved_at,
        approvedBy: permit.approved_by,
        rejectedAt: permit.rejected_at,
        rejectedBy: permit.rejected_by,
        createdBy: permit.created_by,
        createdAt: permit.created_at,
        updatedAt: permit.updated_at,
        returnedQuantity: 0, // Will be populated below after fetching returns
        quotationRequest: permit.sales_orders?.quotation_request_number
          ? {
              qrNumber: permit.sales_orders.quotation_request_number,
              fileName: permit.sales_orders.quotation_request_file_name,
              filePath: permit.sales_orders.quotation_request_file_path,
              uploadedAt: permit.sales_orders.quotation_request_uploaded_at,
            }
          : null,
        items: items.map((item: any) => ({
          id: item.item_id?.toString(),
          permitId: item.permit_id?.toString(),
          productId: item.product_id?.toString(),
          itemNameSnapshot: item.item_name_snapshot,
          skuSnapshot: item.sku_snapshot,
          unitSnapshot: item.unit_snapshot,
          quantity: item.quantity,
          unitPrice: item.unit_price,
          unitCost: item.unit_cost ?? item.unit_price ?? null,
          total: item.total,
          warehouseId: item.warehouse_id,
          allocatedQuantity: item.allocated_quantity,
          allocationNotes: item.allocation_notes,
          supplierId: item.supplier_id?.toString() || "",
          supplierName: item.suppliers?.supplier_name || item.outsourced_name || "",
          outsourcedName: item.outsourced_name || "",
        })),
        files: files.map((file: any) => ({
          id: file.file_id?.toString(),
          permitId: file.permit_id?.toString(),
          fileType: file.file_type,
          fileUrl: file.file_url,
          fileName: file.file_name,
          uploadedBy: file.uploaded_by,
          uploadedAt: file.uploaded_at,
          notes: file.notes,
        })),
      }
    })

    // Returned quantities (Batch 2): valid = non-rejected returns whose permit_id is this delivery permit's id.
    // Historical "RET-<timestamp>" returns carry no permit link and are intentionally not counted.
    let returnLines: Awaited<ReturnType<typeof loadReturnLines>> = []
    try {
      returnLines = await loadReturnLines(supabase, permitIds)
    } catch (returnsError: any) {
      console.error("Delivery Permits GET: could not load returns (showing 0 returned):", returnsError?.message)
    }
    const returnedTotals = returnedTotalsByPermit(returnLines)

    const finalPermits = permitsWithItems.map((permit: any) => {
      const permitNumericId = Number(permit.id)
      const keyed = (permit.items || []).map((item: any) => ({
        key: lineKey(item.productId ? Number(item.productId) : null, item.itemNameSnapshot),
        quantity: Number(item.quantity) || 0,
      }))
      const net = netLineQuantities(keyed, returnedByKey(returnLines, { permitId: permitNumericId }))
      return {
        ...permit,
        returnedQuantity: returnedTotals.get(permitNumericId) || 0,
        items: (permit.items || []).map((item: any, idx: number) => ({ ...item, returnedQuantity: keyed[idx].quantity - net[idx] })),
      }
    })

    return NextResponse.json(finalPermits)
  } catch (error: any) {
    console.error("Delivery Permits GET error:", error)
    return NextResponse.json({ error: error.message || "Failed to fetch delivery permits" }, { status: 500 })
  }
}

// POST - Create a new delivery permit (auto-generated when SO is created)
export async function POST(request: NextRequest) {
  try {
    const supabase = createAdminClient()
    const body = await request.json()

    const { salesOrderId, customerId, recipientName, recipientPhone, deliveryAddress, items, createdBy } = body

    // Server-side quantity cap: per stock line (product), quantity on non-rejected permits may not exceed the SO line.
    // Outsourced lines are not capped (the browser does not cap them and their names are not a reliable key).
    if (items && items.length > 0) {
      const soIdNum = Number.parseInt(salesOrderId)
      const { data: soLines } = await supabase.from("sales_order_items").select("product_id, quantity").eq("so_id", soIdNum)
      const ordered = new Map<string, number>()
      for (const l of soLines || []) {
        if (!l.product_id) continue
        const k = lineKey(l.product_id, null)
        ordered.set(k, (ordered.get(k) || 0) + (Number(l.quantity) || 0))
      }
      const used = new Map<string, number>()
      const { data: openPermits } = await supabase
        .from("delivery_permits")
        .select("permit_id")
        .eq("sales_order_id", soIdNum)
        .neq("status", "REJECTED")
      const openIds = (openPermits || []).map((p: any) => p.permit_id)
      if (openIds.length > 0) {
        const { data: prior } = await supabase.from("delivery_permit_items").select("product_id, quantity").in("permit_id", openIds)
        for (const it of prior || []) {
          if (!it.product_id) continue
          const k = lineKey(it.product_id, null)
          used.set(k, (used.get(k) || 0) + (Number(it.quantity) || 0))
        }
      }
      const requested = new Map<string, number>()
      for (const it of items) {
        const pid = it.productId ? Number.parseInt(it.productId) : null
        if (!pid) continue
        const k = lineKey(pid, null)
        requested.set(k, (requested.get(k) || 0) + (Number(it.quantity) || 0))
      }
      const over: any[] = []
      for (const [k, qty] of requested) {
        if (!ordered.has(k)) continue
        const orderedQty = ordered.get(k) || 0
        const already = used.get(k) || 0
        if (already + qty > orderedQty) {
          over.push({ productId: Number(k.slice(2)), ordered: orderedQty, alreadyOnPermits: already, requested: qty, remaining: Math.max(0, orderedQty - already) })
        }
      }
      if (over.length > 0) {
        return NextResponse.json(
          { error: "The requested quantity exceeds what is left on the sales order.", code: "DP_OVER_QUANTITY", lines: over },
          { status: 409 },
        )
      }
    }

    // Generate permit number
    const year = new Date().getFullYear()
    const { data: lastPermit, error: lastPermitError } = await withRetry(() =>
      supabase
        .from("delivery_permits")
        .select("permit_no")
        .like("permit_no", `DP-${year}-%`)
        .order("permit_no", { ascending: false })
        .limit(1)
        .maybeSingle(),
    )

    if (lastPermitError) {
      console.error("Error fetching last permit:", lastPermitError)
    }

    let nextNumber = 1
    if (lastPermit?.permit_no) {
      const lastNum = Number.parseInt(lastPermit.permit_no.split("-").pop() || "0")
      nextNumber = lastNum + 1
    }
    const permitNo = `DP-${year}-${String(nextNumber).padStart(4, "0")}`


    // Create the permit
    const { data: permit, error: permitError } = await withRetry(() =>
      supabase
        .from("delivery_permits")
        .insert({
          permit_no: permitNo,
          sales_order_id: Number.parseInt(salesOrderId),
          customer_id: customerId ? Number.parseInt(customerId) : null,
          recipient_name: recipientName,
          recipient_phone: recipientPhone,
          delivery_address: deliveryAddress,
          status: "DRAFT",
          created_by: null, // Set to null instead of user ID to avoid FK constraint
        })
        .select()
        .single(),
    )

    if (permitError) {
      console.error("Delivery Permit creation error:", permitError.message)
      return NextResponse.json({ error: permitError.message }, { status: 409 })
    }

    // Create permit items (snapshot of SO items)
    if (items && items.length > 0) {
      
      const permitItems = items.map((item: any) => ({
        permit_id: permit.permit_id,
        product_id: item.productId ? Number.parseInt(item.productId) : null,
        item_name_snapshot: item.productName || item.itemNameSnapshot,
        sku_snapshot: item.sku || item.skuSnapshot,
        unit_snapshot: item.unit || item.unitSnapshot,
        quantity: item.quantity,
        unit_price: item.unitPrice,
        total: item.total,
        supplier_id: item.supplierId ? Number.parseInt(item.supplierId) : null,
        outsourced_name: item.supplierName || null, // Store supplier name here (item name is in item_name_snapshot)
      }))


      const { error: itemsError } = await withRetry(() => supabase.from("delivery_permit_items").insert(permitItems))

      if (itemsError) {
        console.error("Delivery Permit items error:", itemsError)
      }
    }

    // Update sales order fulfillment status to PENDING only if it's the first DP
    // Do NOT reset payment_active - it should only be managed by the accountant approval flow
    const { data: existingPermits } = await supabase
      .from("delivery_permits")
      .select("permit_id")
      .eq("sales_order_id", Number.parseInt(salesOrderId))
      .neq("permit_id", permit.permit_id)
    
    // Only update fulfillment if this is the first DP or SO hasn't been delivered yet
    const isFirstDP = !existingPermits || existingPermits.length === 0
    const soFulfillmentUpdate: any = { fulfillment_status: "PENDING" }
    if (isFirstDP) {
      soFulfillmentUpdate.payment_active = false
    }
    await withRetry(() =>
      supabase
        .from("sales_orders")
        .update(soFulfillmentUpdate)
        .eq("so_id", Number.parseInt(salesOrderId)),
    )

    if (items && items.length > 0) {
      for (const item of items) {
        if (item.productId) {
          // Get current inventory
          const { data: invData } = await supabase
            .from("inventory")
            .select("quantity")
            .eq("product_id", Number.parseInt(item.productId))
            .single()

          if (invData) {
            // Note: pending_outbound column doesn't exist in inventory table
            // The quantity field tracks the actual stock
            console.log(
              `[v0] DP created for product ${item.productId}: quantity ${item.quantity} (inventory tracking needs pending_outbound column)`,
            )
          }
        }
      }
    }

    // Log workflow event
    await withRetry(() =>
      supabase.from("workflow_events").insert({
        entity_type: "DELIVERY_PERMIT",
        entity_id: permit.permit_id,
        event_type: "CREATED",
        new_value: "DRAFT",
        performed_by: null, // Set to null instead of user ID to avoid FK constraint
        notes: `Delivery permit ${permitNo} created for SO ${salesOrderId}`,
      }),
    )

    return NextResponse.json({
      id: permit.permit_id.toString(),
      permitNo: permit.permit_no,
      status: permit.status,
      message: "Delivery permit created successfully",
    })
  } catch (error) {
    console.error("Delivery Permit POST exception:", error)
    return NextResponse.json({ error: "Failed to create delivery permit" }, { status: 500 })
  }
}

// PUT - Update permit status
// Actions that set a status other than APPROVED; refused when the permit is already APPROVED.
const APPROVED_LOCKED_ACTIONS = ["REJECT", "ALLOCATE_WAREHOUSES", "MARK_READY_FOR_PICKUP", "MARK_PRINTED", "MARK_OUT_FOR_DELIVERY", "MARK_SUBMITTED_SIGNED"]

export async function PUT(request: NextRequest) {
  try {
    const supabase = createAdminClient()
    const body = await request.json()


    const {
      permitId,
      action,
      userId,
      rejectionReason,
      recipientName,
      recipientPhone,
      deliveryAddress,
      driverName,
      courierId,
    } = body

    // Get current permit with sales order data
    const { data: currentPermit, error: fetchError } = await withRetry(() =>
      supabase
        .from("delivery_permits")
        .select(
          "*, sales_orders(so_id, so_number, customer_id, total, payment_type, payment_terms, installments, down_payment_amount, down_payment_percent, remaining_amount, remaining_installment_months, payment_start_date, monthly_amount, schedule_entries, schedule_mode, down_payment_due_date)",
        )
        .eq("permit_id", Number.parseInt(permitId))
        .single(),
    )

    if (fetchError || !currentPermit) {
      console.error("Delivery Permits PUT - Permit not found:", JSON.stringify(fetchError))
      return NextResponse.json({ error: "Permit not found" }, { status: 404 })
    }


    // Approving a permit deducts stock and nothing gives it back, so an APPROVED permit must not be moved to an
    // earlier status (REJECT included). UPDATE_DETAILS and a repeat APPROVE do not change the status backwards.
    if (currentPermit.status === "APPROVED" && APPROVED_LOCKED_ACTIONS.includes(action)) {
      return NextResponse.json(
        { error: "This delivery permit is already approved and its stock has been deducted, so it cannot be changed back.", code: "DP_ALREADY_APPROVED" },
        { status: 409 },
      )
    }

    if (!isAllowedDpTransition(currentPermit.status, action)) {
      return NextResponse.json(
        {
          error: `Action ${action} is not allowed on a delivery permit in status ${currentPermit.status}.`,
          code: "DP_INVALID_TRANSITION",
          from: currentPermit.status,
          action,
        },
        { status: 409 },
      )
    }

    const updates: any = { updated_at: new Date().toISOString() }
    let newStatus = currentPermit.status
    const soUpdates: any = {}
    // Batch 4E-stock: stock taken out of inventory by this APPROVE (undone if the permit cannot be approved).
    let stockMoves: StockMove[] = []

    switch (action) {
      case "UPDATE_DETAILS":
        if (recipientName) updates.recipient_name = recipientName
        if (recipientPhone) updates.recipient_phone = recipientPhone
        if (deliveryAddress) updates.delivery_address = deliveryAddress
        break

      case "ALLOCATE_WAREHOUSES":
        // Save warehouse allocations for each item
        const { allocations, notes } = body
        if (allocations && Array.isArray(allocations)) {
          for (const alloc of allocations) {
            const { error: allocError } = await supabase
              .from("delivery_permit_items")
              .update({
                warehouse_id: alloc.warehouseId,
                allocated_quantity: alloc.quantity,
                allocation_notes: notes || null,
              })
              .eq("item_id", alloc.itemId)
            
            if (allocError) {
              console.error("Error updating item allocation:", allocError)
            }
          }
        }
        newStatus = "READY_FOR_SHIPMENT"
        updates.status = newStatus
        updates.allocated_at = new Date().toISOString()
        updates.allocated_by = userId ? Number.parseInt(userId) : null
        soUpdates.fulfillment_status = "READY_FOR_SHIPMENT"
        break

      case "MARK_READY_FOR_PICKUP":
        newStatus = "READY_FOR_PICKUP"
        updates.status = newStatus
        updates.printed_at = new Date().toISOString()
        updates.printed_by = userId ? Number.parseInt(userId) : null
        soUpdates.fulfillment_status = "READY_FOR_PICKUP"
        soUpdates.status = "ready_for_delivery"
        break

      case "MARK_PRINTED":
        newStatus = "PRINTED"
        updates.status = newStatus
        updates.printed_at = new Date().toISOString()
        updates.printed_by = userId ? Number.parseInt(userId) : null
        break

      case "MARK_OUT_FOR_DELIVERY":
        newStatus = "OUT_FOR_DELIVERY"
        updates.status = newStatus
        updates.out_for_delivery_at = new Date().toISOString()
        updates.out_for_delivery_by = userId ? Number.parseInt(userId) : null
        if (driverName) {
          updates.driver_name = driverName
        }
        if (courierId && courierId !== "none" && !isNaN(Number(courierId))) {
          const empId = Number.parseInt(courierId)
          updates.assigned_employee_id = empId
          // Also set courier_id for backward compatibility (FK constraint removed)
          updates.courier_id = empId
        }
        soUpdates.fulfillment_status = "OUT_FOR_DELIVERY"
        break

    case "MARK_SUBMITTED_SIGNED":
      newStatus = "SUBMITTED_SIGNED"
      updates.status = newStatus
      updates.submitted_signed_at = new Date().toISOString()
      updates.submitted_signed_by = userId ? Number.parseInt(userId) : null
      
      // Only mark the SO as delivered once every line item's ordered quantity has been
      // covered by delivered permits — a single delivered DP does not mean the whole SO shipped.
      if (currentPermit.sales_order_id) {
        const fullyDelivered = await isSOFullyDelivered(
          supabase,
          currentPermit.sales_order_id,
          Number.parseInt(permitId),
          newStatus,
        )

        if (fullyDelivered) {
          soUpdates.status = "delivered"
          soUpdates.fulfillment_status = "DELIVERED"
        } else {
          soUpdates.fulfillment_status = "PARTIALLY_DELIVERED"
        }
      }
      break

      case "APPROVE":
        const dpApprovalKey = generateDPApprovalIdempotencyKey(Number.parseInt(permitId))

        const idempotencyCheck = await checkIdempotency(
          "dp_approval",
          dpApprovalKey,
          "delivery_permits",
          Number.parseInt(permitId),
          userId,
        )

        if (!idempotencyCheck.success) {
          if (idempotencyCheck.isRetry) {
            return NextResponse.json({
              message: "Delivery permit has already been approved",
              isDuplicate: true,
            })
          }
          return NextResponse.json({ error: idempotencyCheck.error }, { status: 400 })
        }

        try {
          newStatus = "APPROVED"
          updates.status = newStatus
          updates.approved_at = new Date().toISOString()
          updates.approved_by_user_id = userId ? Number.parseInt(userId) : null
          updates.approval_processing = true

          // Activate payment plan when FIRST DP is approved, but only mark SO as delivered when ALL DPs are delivered
          soUpdates.payment_active = true
          soUpdates.payment_activated_at = new Date().toISOString()
          
          // Only mark the SO as delivered once every line item's ordered quantity has been
          // covered by delivered permits — a single approved DP does not mean the whole SO shipped.
          if (currentPermit.sales_order_id) {
            const fullyDelivered = await isSOFullyDelivered(
              supabase,
              currentPermit.sales_order_id,
              Number.parseInt(permitId),
              newStatus,
            )

            if (fullyDelivered) {
              soUpdates.fulfillment_status = "DELIVERED"
              soUpdates.status = "delivered"
            } else {
              soUpdates.fulfillment_status = "PARTIALLY_DELIVERED"
            }
          }


          if (currentPermit.sales_order_id) {
            const { data: soData, error: soError } = await withRetry(() =>
              supabase
                .from("sales_orders")
                .select(
                  "so_id, so_number, customer_id, total, payment_type, payment_terms, installments, down_payment_amount, down_payment_percent, remaining_amount, remaining_installment_months, payment_start_date, monthly_amount, schedule_entries, schedule_mode, down_payment_due_date",
                )
                .eq("so_id", currentPermit.sales_order_id)
                .single(),
            )

            if (soError) {
              console.error("Delivery Permits PUT - Failed to fetch SO:", soError.message)
            } else if (soData) {
              // NOTE: AR Invoice creation has been removed from here.
              // Invoices should only be created manually by the accountant 
              // through the Accounts Receivable module using "Create from DPs" button.
            }
          }

          // Batch 4E-stock: stock is DEDUCTED when the permit is approved (it was on hold since the SO was approved).
          // Done last, right before the status change, so a refusal changes nothing. A permit that is already
          // APPROVED (including every permit approved before this change) is never deducted (again).
          if (currentPermit.status !== "APPROVED") {
            const deduction = await deductStockForPermit(supabase, currentPermit)
            if (!deduction.ok) {
              await completeIdempotency("dp_approval", dpApprovalKey, false, deduction.body.error)
              return NextResponse.json(deduction.body, { status: deduction.status })
            }
            if (deduction.state === "deducted") stockMoves = deduction.moves
          }

          // After successful approval:
          await completeIdempotency("dp_approval", dpApprovalKey, true)
          updates.approval_processing = false
        } catch (error: any) {
          if (stockMoves.length > 0) await abortDeduction(supabase, currentPermit, stockMoves, error.message)
          await completeIdempotency("dp_approval", dpApprovalKey, false, error.message)
          updates.approval_processing = false
          throw error
        }
        break

      case "REJECT":
        newStatus = "REJECTED"
        updates.status = newStatus
        updates.rejected_at = new Date().toISOString()
        {
          // rejected_by is an FK to users.user_id: only record it when that user exists (the role picker sends ids that may not)
          const rejectedBy = userId ? Number.parseInt(userId) : Number.NaN
          if (Number.isInteger(rejectedBy)) {
            const { data: rejector } = await supabase.from("users").select("user_id").eq("user_id", rejectedBy).limit(1)
            if (rejector && rejector.length > 0) updates.rejected_by = rejectedBy
          }
        }
        updates.rejection_reason = rejectionReason
        break

      default:
        return NextResponse.json({ error: "Invalid action" }, { status: 400 })
    }

    // Update permit
    let updatedPermit: any
    let updateError: any
    try {
      const result = await withRetry(() =>
        supabase.from("delivery_permits").update(updates).eq("permit_id", Number.parseInt(permitId)).select().single(),
      )
      updatedPermit = result.data
      updateError = result.error
    } catch (thrown: any) {
      updateError = { message: thrown?.message || "Failed to update delivery permit" }
    }

    if (updateError) {
      console.error("Delivery Permit update error:", updateError)
      if (stockMoves.length > 0) {
        const restored = await abortDeduction(supabase, currentPermit, stockMoves, updateError.message)
        return NextResponse.json(
          {
            error: restored
              ? `${updateError.message}. The permit was not approved and the stock was put back.`
              : `${updateError.message}. The permit was not approved but the stock could not be fully put back: contact an administrator.`,
          },
          { status: 500 },
        )
      }
      return NextResponse.json({ error: updateError.message }, { status: 500 })
    }
    if (stockMoves.length > 0) await finishDeduction(supabase, currentPermit, stockMoves, userId)


    // Update sales order if needed
    if (Object.keys(soUpdates).length > 0 && currentPermit.sales_order_id) {
      const { error: soError } = await withRetry(() =>
        supabase.from("sales_orders").update(soUpdates).eq("so_id", currentPermit.sales_order_id),
      )
      if (soError) {
        console.error("Delivery Permits PUT - SO update error:", soError.message)
      } else {
      }
    }

    // Log workflow event
    await withRetry(() =>
      supabase.from("workflow_events").insert({
        entity_type: "DELIVERY_PERMIT",
        entity_id: Number.parseInt(permitId),
        event_type: "STATUS_CHANGED",
        old_value: currentPermit.status,
        new_value: newStatus,
        performed_by: userId ? Number.parseInt(userId) : null,
        notes: action === "REJECT" ? `Rejected: ${rejectionReason}` : `Action: ${action}`,
      }),
    )

    return NextResponse.json({
      id: updatedPermit.permit_id.toString(),
      permitNo: updatedPermit.permit_no,
      status: updatedPermit.status,
      message: `Permit ${action.toLowerCase().replace(/_/g, " ")} successfully`,
    })
  } catch (error) {
    console.error("Delivery Permit PUT exception:", error)
    return NextResponse.json({ error: "Failed to update delivery permit" }, { status: 500 })
  }
}
