import type { SupabaseClient } from "@supabase/supabase-js"

export interface ConvertedSo {
  so_id: number
  so_number: string
}

// Quotation statuses (sales_quotations.status CHECK) that can no longer be edited,
// converted, or rejected.
export const LOCKED_QUOTATION_STATUSES = ["rejected", "expired"]

// A quotation counts as converted when a sales order points at it through
// sales_orders.parent_quotation_id. The quotation's own status is not changed on
// conversion. When several exist (historical duplicates) the earliest is returned.
export async function getConvertedSo(admin: SupabaseClient, quotationId: number): Promise<ConvertedSo | null> {
  const { data, error } = await admin
    .from("sales_orders")
    .select("so_id, so_number")
    .eq("parent_quotation_id", quotationId)
    .order("so_id", { ascending: true })
    .limit(1)

  if (error) throw error
  return data && data.length > 0 ? (data[0] as ConvertedSo) : null
}

// Returns the reason a quotation is locked ("rejected", "expired", or a message naming the
// sales order it was converted into), or null when it can still be edited/converted.
export async function getQuotationLockReason(
  admin: SupabaseClient,
  quotation: { id: number; status: string | null },
): Promise<string | null> {
  if (quotation.status && LOCKED_QUOTATION_STATUSES.includes(quotation.status)) {
    return `This quotation is ${quotation.status} and can no longer be changed.`
  }
  const converted = await getConvertedSo(admin, quotation.id)
  if (converted) {
    return `This quotation has already been converted to Sales Order ${converted.so_number} and can no longer be changed.`
  }
  return null
}
