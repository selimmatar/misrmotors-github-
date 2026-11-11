// The purchase-order history log (workflow_events, entity_type PURCHASE_ORDER). Its time column is performed_at (filled
// by the database) and performed_by must be a real users.user_id, so an unknown id is left empty instead of making the
// insert fail. A failed write is logged, never silently lost.
type Db = any

export async function knownUserId(db: Db, raw: unknown): Promise<number | null> {
  const id = Number.parseInt(String(raw ?? ""), 10)
  if (!Number.isSafeInteger(id) || id < 1) return null
  const { data } = await db.from("users").select("user_id").eq("user_id", id).maybeSingle()
  return data ? id : null
}

export async function logPoEvent(
  db: Db,
  poId: number,
  event: { event_type: string; old_value?: string | null; new_value?: string | null; notes?: string | null; userId?: unknown },
): Promise<void> {
  const { userId, ...fields } = event
  const { error } = await db.from("workflow_events").insert({
    entity_type: "PURCHASE_ORDER",
    entity_id: poId,
    ...fields,
    performed_by: await knownUserId(db, userId),
  })
  if (error) console.error(`PO history: could not record ${event.event_type} for PO ${poId}`, error)
}
