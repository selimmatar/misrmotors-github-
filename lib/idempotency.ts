/**
 * Idempotency Guards for Critical Operations
 * Prevents duplicate transactions and ensures data integrity
 */

import { getAdminClient } from "./supabase/admin"

export type OperationType =
  | "payment"
  | "audit"
  | "dp_approval"
  | "po_receive"
  | "po_finalize_cost"
  | "ar_invoice_create"

export type IdempotencyResult =
  | { success: true; isRetry: false }
  | { success: false; isRetry: true; previousResult: any }
  | { success: false; error: string }

/**
 * Check if an operation has already been processed
 * Returns existing result if operation was completed, or locks it for processing
 */
export async function checkIdempotency(
  operationType: OperationType,
  idempotencyKey: string,
  entityType: string,
  entityId: number,
  userId?: string,
): Promise<IdempotencyResult> {
  const supabase = getAdminClient()

  try {
    // Check if operation already exists
    const { data: existing, error: checkError } = await supabase
      .from("idempotency_log")
      .select("*")
      .eq("operation_type", operationType)
      .eq("idempotency_key", idempotencyKey)
      .single()

    if (checkError && checkError.code !== "PGRST116") {
      // PGRST116 = not found, which is OK
      return { success: false, error: `Idempotency check failed: ${checkError.message}` }
    }

    // If operation exists and is completed, return the previous result
    if (existing && existing.status === "completed") {
      console.log(`[v0] Idempotency: Operation ${operationType} with key ${idempotencyKey} already completed`)
      return {
        success: false,
        isRetry: true,
        previousResult: existing,
      }
    }

    // If operation exists and is still processing, reject (concurrent request)
    if (existing && existing.status === "processing") {
      const processingTime = Date.now() - new Date(existing.created_at).getTime()
      if (processingTime < 60000) {
        // Less than 1 minute
        return { success: false, error: "Operation is already being processed" }
      }
      // If processing for more than 1 minute, assume it failed and allow retry
      console.warn(`[v0] Idempotency: Stale processing lock detected for ${idempotencyKey}, allowing retry`)
    }

    // Create or update the idempotency record to lock it
    const { error: insertError } = await supabase.from("idempotency_log").upsert(
      {
        operation_type: operationType,
        idempotency_key: idempotencyKey,
        entity_type: entityType,
        entity_id: entityId,
        user_id: userId,
        status: "processing",
        created_at: new Date().toISOString(),
      },
      {
        onConflict: "operation_type,idempotency_key",
      },
    )

    if (insertError) {
      return { success: false, error: `Failed to lock operation: ${insertError.message}` }
    }

    return { success: true, isRetry: false }
  } catch (error: any) {
    return { success: false, error: error.message }
  }
}

/**
 * Mark an operation as completed
 */
export async function completeIdempotency(
  operationType: OperationType,
  idempotencyKey: string,
  success: boolean,
  errorMessage?: string,
): Promise<void> {
  const supabase = getAdminClient()

  await supabase
    .from("idempotency_log")
    .update({
      status: success ? "completed" : "failed",
      completed_at: new Date().toISOString(),
      error_message: errorMessage,
    })
    .eq("operation_type", operationType)
    .eq("idempotency_key", idempotencyKey)
}

/**
 * Generate an idempotency key for payment operations
 */
export function generatePaymentIdempotencyKey(invoiceId: number, scheduleId: number, timestamp?: number): string {
  const ts = timestamp || Date.now()
  return `pay_${invoiceId}_${scheduleId}_${ts}`
}

/**
 * Generate an idempotency key for audit operations
 */
export function generateAuditIdempotencyKey(sessionId: string, productId: number): string {
  return `audit_${sessionId}_${productId}`
}

/**
 * Generate an idempotency key for delivery permit approval
 */
export function generateDPApprovalIdempotencyKey(permitId: number): string {
  return `dp_approve_${permitId}_${Date.now()}`
}

/**
 * Generate an idempotency key for PO receive
 */
export function generatePOReceiveIdempotencyKey(poId: number): string {
  return `po_receive_${poId}_${Date.now()}`
}
