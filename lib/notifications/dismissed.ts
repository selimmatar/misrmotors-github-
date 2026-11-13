// Hiding suggestions in the "Waiting for you" lists (owner request, 2026-11-13): a sales order that needs a PO, a PO
// waiting for approval, or a price request waiting for the supplier can be hidden when it is handled another way.
// Stored in workflow_events (entity_type SUGGESTION, event_type SUGGESTION_DISMISSED, new_value = the key) — no new
// table. A key carries what the suggestion says, so a sales order comes back by itself when its shortfall changes.
// Hidden for everyone; "Show again" removes it. The sidebar counters leave hidden items out too.
type Db = any

export const DISMISS_EVENT = "SUGGESTION_DISMISSED"
export type SuggestionKind = "so-needs-po" | "po-pending" | "price-request"

export const soNeedsPoKey = (soId: number, items: string[]) => `so-needs-po:${soId}:${[...items].sort().join("|")}`
export const poPendingKey = (poId: number) => `po-pending:${poId}`
export const priceRequestKey = (requestId: number) => `price-request:${requestId}`

/** The id a key is about (stored as entity_id so the log stays readable). */
export const keyEntityId = (key: string) => Number(key.split(":")[1]) || 0
export const isSuggestionKey = (key: unknown): key is string =>
  typeof key === "string" && key.length <= 2000 && /^(so-needs-po|po-pending|price-request):\d{1,9}(:.*)?$/s.test(key)

/** Every hidden suggestion key. A failed read hides nothing. */
export async function loadDismissed(db: Db): Promise<Set<string>> {
  const { data, error } = await db.from("workflow_events").select("new_value").eq("entity_type", "SUGGESTION").eq("event_type", DISMISS_EVENT)
  if (error) {
    console.error("hidden suggestions: read failed", error)
    return new Set()
  }
  return new Set((data || []).map((r: any) => String(r.new_value || "")))
}
