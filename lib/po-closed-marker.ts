// A PO closed WITHOUT a closing bill (owner request, 2026-11-18): when its bills for received items already took
// everything, "Close PO" makes no 0 EGP bill. The PO is then marked closed in its history (workflow_events): a PO_CLOSED
// event whose new_value is NO_BILL. It counts as closed while that is its latest PO_CLOSED / PO_REOPENED event; "Reopen"
// clears it by recording PO_REOPENED. No database change is needed. A PO with its closing bill (APINV-<po>) is closed
// as before (lib/po-bill-number.ts); this marker only covers the PO without one.
import { knownUserId } from "./po-history"

type Db = any

/** new_value of the PO_CLOSED event of a PO closed without a bill. */
export const PO_CLOSED_NO_BILL = "NO_BILL"
const ENTITY = "PURCHASE_ORDER"

/**
 * The POs closed without a bill. With `poIds` only those are looked at; without, every PO (the PO list). Only POs that
 * ever had a no-bill close are read in full, so this stays small.
 */
export async function closedWithoutBillIds(db: Db, poIds?: number[]): Promise<Set<number>> {
  const out = new Set<number>()
  if (poIds && poIds.length === 0) return out
  let q = db.from("workflow_events").select("entity_id").eq("entity_type", ENTITY).eq("event_type", "PO_CLOSED").eq("new_value", PO_CLOSED_NO_BILL)
  if (poIds) q = q.in("entity_id", poIds)
  const { data: marked, error } = await q
  if (error) throw new Error(`read PO history: ${error.message}`)
  const candidates = [...new Set((marked || []).map((e: any) => Number(e.entity_id)))]
  if (candidates.length === 0) return out
  const { data: events, error: eventsError } = await db
    .from("workflow_events")
    .select("event_id, entity_id, event_type, new_value")
    .eq("entity_type", ENTITY)
    .in("entity_id", candidates)
    .in("event_type", ["PO_CLOSED", "PO_REOPENED"])
  if (eventsError) throw new Error(`read PO history: ${eventsError.message}`)
  const latest = new Map<number, any>()
  for (const e of events || []) {
    const id = Number(e.entity_id)
    const was = latest.get(id)
    if (!was || Number(e.event_id) > Number(was.event_id)) latest.set(id, e)
  }
  for (const [id, e] of latest) if (e.event_type === "PO_CLOSED" && e.new_value === PO_CLOSED_NO_BILL) out.add(id)
  return out
}

/** Key in a PO_REOPENED event's new_value JSON: the closing bill the reopen KEPT (owner decision, 2026-11-22). */
export const KEPT_BILL_KEY = "keptBillId"

/**
 * POs reopened while keeping their closing bill (owner decision, 2026-11-22: a supplier bill is never deleted by a
 * reopen; re-closing updates that same row). poId -> the kept bill's invoice_id, while the PO's latest PO_CLOSED /
 * PO_REOPENED event is that reopen. With `poIds` only those are looked at; without, every PO (the PO list).
 */
export async function reopenedKeepingBill(db: Db, poIds?: number[]): Promise<Map<number, number>> {
  const out = new Map<number, number>()
  if (poIds && poIds.length === 0) return out
  let q = db.from("workflow_events").select("event_id, entity_id, event_type, new_value").eq("entity_type", ENTITY).in("event_type", ["PO_CLOSED", "PO_REOPENED"])
  if (poIds) q = q.in("entity_id", poIds)
  const { data, error } = await q
  if (error) throw new Error(`read PO history: ${error.message}`)
  const latest = new Map<number, any>()
  for (const e of data || []) {
    const id = Number(e.entity_id)
    const was = latest.get(id)
    if (!was || Number(e.event_id) > Number(was.event_id)) latest.set(id, e)
  }
  for (const [id, e] of latest) {
    if (e.event_type !== "PO_REOPENED") continue
    try {
      const kept = Number(JSON.parse(e.new_value || "{}")[KEPT_BILL_KEY])
      if (kept > 0) out.set(id, kept)
    } catch {
      // an older reopen (its bill was removed)
    }
  }
  return out
}

/** The closing bill this PO keeps while reopened, or null. */
export async function keptBillId(db: Db, poId: number): Promise<number | null> {
  return (await reopenedKeepingBill(db, [poId])).get(Number(poId)) ?? null
}

/** True when this PO is closed without a closing bill. */
export async function isClosedWithoutBill(db: Db, poId: number): Promise<boolean> {
  return (await closedWithoutBillIds(db, [poId])).has(Number(poId))
}

/** Records a PO_CLOSED / PO_REOPENED marker event; unlike the history log, a failed write is an error. */
export async function writeCloseMarker(
  db: Db,
  poId: number,
  event: { event_type: "PO_CLOSED" | "PO_REOPENED"; old_value?: string | null; new_value?: string | null; notes: string; userId?: unknown },
): Promise<void> {
  const { userId, ...fields } = event
  const { error } = await db.from("workflow_events").insert({ entity_type: ENTITY, entity_id: poId, ...fields, performed_by: await knownUserId(db, userId) })
  if (error) throw new Error(`record PO ${event.event_type}: ${error.message}`)
}
