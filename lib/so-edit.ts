// Editing a sales order after delivery permits / returns exist (Batch 2).
//
// A returned item must stay on the order as history and a replacement is added next to it, so an edit may:
//   * add lines freely (the replacement / exchange item),
//   * change quantities, but never below what the customer keeps (delivered - returned) for that item,
//   * delete a line of an item the customer keeps none of (everything delivered was returned); the delivery
//     permit and return records stay untouched as history,
// and may NOT:
//   * delete a line the customer still keeps some of, or turn a line into a different item, once that item is on
//     a delivery permit,
//   * change the quantity or price of, or delete, a line whose item is on a delivery permit and has no return
//     (delivered / permitted items are locked; extra quantity goes on a new line, see lib/so-edit-eligibility.ts),
//   * change the customer once delivery permits exist.
// Nothing here writes; the PUT route calls validateSoEdit BEFORE it changes anything.
// While the order has an invoice open for correction (spec §6.5a, `correction`, ruling P15), the sales-order screen may
// also change the quantity and price of a line whose item sits only on the correction's permits (as for a line with a
// return: never below what the customer keeps), and the customer when no other invoice of the order still counts;
// removing a kept line or turning it into another item stays refused. Lines on other permits stay locked.
import { isSOFullyDelivered } from "./delivery-status"
import { computeWholeOrderAmount, loadSoInvoicingState } from "./invoicing"
import { DELIVERED_PERMIT_STATUSES, lineKey, loadReturnLines, returnedByKey } from "./return-lines"

type Db = any // supabase-js client (or a test double)
export type SoEditVerdict = { ok: true } | { ok: false; status: number; error: string }

const must = (result: any, what: string): any => {
  if (result.error) throw new Error(`${what}: ${result.error.message || result.error}`)
  return result.data
}
const EPS = 1e-6

function incomingKey(item: any): string {
  const rawProduct = item?.productId ?? item?.product_id
  const productId = rawProduct !== undefined && rawProduct !== null && rawProduct !== "" ? Number.parseInt(String(rawProduct), 10) : null
  const name = item?.productName || item?.outsourcedName || item?.outsourced_name || ""
  return lineKey(Number.isNaN(productId as number) ? null : productId, name)
}

export async function validateSoEdit(
  db: Db,
  soId: number,
  input: { customerId?: any; items?: any[]; correction?: { permitIds: number[]; liveInvoiceNumbers: string[] } | null },
): Promise<SoEditVerdict> {
  const correction = input.correction || null
  const so = must(await db.from("sales_orders").select("so_id, so_number, customer_id").eq("so_id", soId).maybeSingle(), "load sales order")
  if (!so) return { ok: true } // the route reports "not found" itself

  // A rejected permit never ships, so it holds nothing back (owner request, 2026-11-11).
  const permits = (must(await db.from("delivery_permits").select("permit_id, status").eq("sales_order_id", soId), "load delivery permits") as any[])
    .filter((p) => p.status !== "REJECTED")
  if (permits.length === 0) return { ok: true } // nothing delivered yet: ordinary editing rules

  const soLabel = so.so_number || `#${so.so_id}`
  if (input.customerId !== undefined && input.customerId !== null && input.customerId !== "" && Number(input.customerId) !== so.customer_id) {
    if (!correction) return { ok: false, status: 409, error: `The customer of ${soLabel} cannot be changed once delivery permits exist.` }
    if (correction.liveInvoiceNumbers.length > 0) {
      return {
        ok: false,
        status: 409,
        error: `The customer of ${soLabel} cannot be changed while other invoices of the order still count (${correction.liveInvoiceNumbers.join(", ")}).`,
      }
    }
  }
  if (!input.items) return { ok: true }

  const permitIds = permits.map((p) => p.permit_id)
  const permitItems = must(
    await db.from("delivery_permit_items").select("permit_id, product_id, item_name_snapshot, quantity").in("permit_id", permitIds),
    "load delivery permit items",
  ) as any[]
  const stored = must(
    await db.from("sales_order_items").select("so_item_id, product_id, outsourced_name, quantity, unit_price").eq("so_id", soId),
    "load sales order items",
  ) as any[]
  const returns = returnedByKey(await loadReturnLines(db, permitIds))

  const onPermit = new Set<string>() // items that appear on any permit: their order lines are history
  const names = new Map<string, string>() // item name as printed on the permit, for messages
  const delivered = new Map<string, number>()
  const permitted = new Map<string, number>() // on live (not rejected) permits, delivered or not
  for (const item of permitItems) {
    const key = lineKey(item.product_id, item.item_name_snapshot)
    onPermit.add(key)
    permitted.set(key, (permitted.get(key) || 0) + (Number(item.quantity) || 0))
    if (item.item_name_snapshot && !names.has(key)) names.set(key, item.item_name_snapshot)
    const permit = permits.find((p) => p.permit_id === item.permit_id)
    if (permit && DELIVERED_PERMIT_STATUSES.includes(permit.status)) delivered.set(key, (delivered.get(key) || 0) + (Number(item.quantity) || 0))
  }
  // a line may be corrected only when its item sits on no permit outside the open correction(s)
  const outside = new Set(
    permitItems.filter((i) => !(correction?.permitIds || []).includes(Number(i.permit_id))).map((i) => lineKey(i.product_id, i.item_name_snapshot)),
  )
  const unlocked = (key: string) => correction !== null && !outside.has(key)
  const label = (key: string) => names.get(key) || key.slice(2) || "this item"
  // What the customer has or is about to get: on live permits, less what came back. A returned / refused quantity is
  // free again: it may be edited, removed or put on a new delivery permit.
  const kept = (key: string) => Math.max(0, (permitted.get(key) || 0) - (returns.get(key) || 0))

  const incomingById = new Map<number, any>()
  for (const item of input.items) {
    const id = item?.id ?? item?.so_item_id ?? item?.soItemId
    if (id !== undefined && id !== null && id !== "") incomingById.set(Number(id), item)
  }

  const renamed = new Map<string, string>() // old key -> new key of an outsourced line renamed during a correction
  for (const row of stored) {
    const key = lineKey(row.product_id, row.outsourced_name)
    if (!onPermit.has(key)) continue
    const incoming = incomingById.get(row.so_item_id)
    if (!unlocked(key) && (returns.get(key) || 0) <= EPS) {
      // On a permit with no return: the line is locked.
      const lockedError = `"${label(key)}" is on a delivery permit of ${soLabel}; its quantity and price cannot be changed and it cannot be removed. Add any extra quantity or a different item as a new line.`
      if (!incoming || incomingKey(incoming) !== key) return { ok: false, status: 409, error: lockedError }
      const price = incoming.unitPrice ?? incoming.unit_price
      if (Math.abs((Number(incoming.quantity) || 0) - (Number(row.quantity) || 0)) > EPS) return { ok: false, status: 409, error: lockedError }
      if (price !== undefined && price !== null && price !== "" && Math.abs(Number(price) - (Number(row.unit_price) || 0)) > EPS) {
        return { ok: false, status: 409, error: lockedError }
      }
      continue
    }
    if (!incoming) {
      if (kept(key) <= EPS) continue // fully returned: the line may go, its permit and return stay as history
      return { ok: false, status: 409, error: `"${label(key)}" is on a delivery permit of ${soLabel} and cannot be removed while the customer keeps ${kept(key)} of it. Lower the line to ${kept(key)} instead, and add any replacement as a new line.` }
    }
    // During a correction an outsourced line may be renamed (same line, still outsourced): its permit lines follow it.
    if (unlocked(key) && !row.product_id && incomingKey(incoming).startsWith("n:") && incomingKey(incoming) !== key) {
      renamed.set(key, incomingKey(incoming))
      continue
    }
    if (incomingKey(incoming) !== key && kept(key) > EPS) {
      return { ok: false, status: 409, error: `"${label(key)}" is on a delivery permit of ${soLabel}; its line cannot be turned into a different item. Add the replacement as a new line.` }
    }
  }

  const orderedAfter = new Map<string, number>()

  for (const item of input.items) {
    const key = incomingKey(item)
    orderedAfter.set(key, (orderedAfter.get(key) || 0) + (Number(item?.quantity) || 0))
  }
  for (const key of onPermit) {
    const keep = kept(key)
    const after = orderedAfter.get(renamed.get(key) ?? key) || 0
    if (after + EPS < keep) {
      return {
        ok: false,
        status: 409,
        error: `"${label(key)}": ${keep} are kept by the customer or on a delivery permit (on permits ${permitted.get(key) || 0}, delivered ${delivered.get(key) || 0}, returned ${returns.get(key) || 0}), so the order cannot go below ${keep}.`,
      }
    }
  }
  return { ok: true }
}

/**
 * Keeps the order's CURRENT total return-aware: `net_total` = the order total less the value of returned quantity
 * (what the customer actually keeps and owes); `total` stays the ordered value of the lines. With no returns they are
 * equal. Example: 10 x 10,000, 2 returned -> net 80,000 x 1.14; after the edit "8 x A + 2 x B" -> 104,000 x 1.14.
 * Derived data: it is recomputed from the order, its permits and its (non-rejected) returns, so running it twice,
 * or after any later change, converges to the same value. The returns themselves are never touched.
 */
export async function syncSalesOrderNetTotal(db: Db, soId: number): Promise<number | null> {
  let written: number | null = null
  // Compute, write, then verify against a fresh computation: if a concurrent return / edit changed the inputs in
  // between, write again (a few rounds at most), so the stored value converges on the current state.
  for (let round = 0; round < 3; round++) {
    const state = await loadSoInvoicingState(db, soId)
    if (!state) return null
    const priced = computeWholeOrderAmount(state)
    const net = priced.ok ? priced.amount : 0
    if (written !== null && net === written) return written
    const rows = must(await db.from("sales_orders").update({ net_total: net }).eq("so_id", soId).select("so_id"), "update order net total") as any[]
    if (rows.length !== 1) return null
    written = net
  }
  return written
}

/**
 * After an edit: an order that was marked delivered but now has something outstanding (a replacement line, or a
 * returned quantity that is still owed) goes back to "ready for delivery / partially delivered" so the replacement
 * can be shipped on a new delivery permit. Returns true when the order was re-opened.
 */
export async function reopenIfNotFullyDelivered(db: Db, soId: number): Promise<boolean> {
  const so = must(await db.from("sales_orders").select("so_id, status").eq("so_id", soId).maybeSingle(), "load sales order")
  if (!so || so.status !== "delivered") return false
  if (await isSOFullyDelivered(db, soId)) return false
  const rows = must(
    await db
      .from("sales_orders")
      .update({ status: "ready_for_delivery", fulfillment_status: "PARTIALLY_DELIVERED" })
      .eq("so_id", soId)
      .eq("status", "delivered")
      .select("so_id"),
    "re-open sales order",
  ) as any[]
  return rows.length === 1
}

/**
 * After an edit (owner report, 2026-11-12, SO-2026-742962): an order whose lines now match what the customer kept
 * (delivered less returned, e.g. a returned line removed or lowered) IS fully delivered, so it moves forward to
 * "delivered", the same way signing the last permit does. Only an order that is being delivered (a signed / approved
 * permit exists) and is not already delivered, cancelled or waiting for approval. Returns true when it was moved.
 */
export async function markDeliveredIfComplete(db: Db, soId: number): Promise<boolean> {
  const so = must(await db.from("sales_orders").select("so_id, status, fulfillment_status").eq("so_id", soId).maybeSingle(), "load sales order")
  if (!so || !["accountant_approved", "ready_for_delivery", "shipped"].includes(String(so.status))) return false
  const permits = must(await db.from("delivery_permits").select("permit_id, status").eq("sales_order_id", soId), "load delivery permits") as any[]
  if (!permits.some((p) => ["SUBMITTED_SIGNED", "DELIVERED", "APPROVED"].includes(p.status))) return false
  if (!(await isSOFullyDelivered(db, soId))) return false
  const rows = must(
    await db
      .from("sales_orders")
      .update({ status: "delivered", fulfillment_status: "DELIVERED" })
      .eq("so_id", soId)
      .eq("status", so.status)
      .select("so_id"),
    "mark sales order delivered",
  ) as any[]
  return rows.length === 1
}

// ---- correct and reissue (spec §6.5a, ruling P11) ----

export interface PermitLineUpdate {
  itemId: number
  patch: { unit_price?: number; total?: number; item_name_snapshot?: string }
}

const incomingName = (item: any): string => String(item?.productName || item?.outsourcedName || item?.outsourced_name || "").trim()

/**
 * While a correction is open, an order edit that changes a line's unit price or item name is copied onto the matching
 * delivery-permit lines of that correction's permits (`permitIds`), so the order, the permits and the new invoice
 * agree. A permit line comes from the order line with the same item (lineKey: product, or name for an outsourced
 * line). When the order has the same item on two lines that would give it different prices or names, the permits can't
 * tell them apart and the edit is refused. Nothing here writes.
 */
export async function correctionPermitUpdates(
  db: Db,
  soId: number,
  items: any[],
  permitIds: number[],
): Promise<{ ok: true; updates: PermitLineUpdate[] } | { ok: false; status: number; error: string }> {
  if (!Array.isArray(items) || permitIds.length === 0) return { ok: true, updates: [] }
  const stored = must(
    await db.from("sales_order_items").select("so_item_id, product_id, outsourced_name, quantity, unit_price").eq("so_id", soId),
    "load sales order items",
  ) as any[]
  const permitLines = must(
    await db.from("delivery_permit_items").select("item_id, permit_id, product_id, item_name_snapshot, quantity, unit_price, total").in("permit_id", permitIds),
    "load delivery permit items",
  ) as any[]
  const incomingById = new Map<number, any>()
  for (const item of items) {
    const id = item?.id ?? item?.so_item_id ?? item?.soItemId
    if (id !== undefined && id !== null && id !== "") incomingById.set(Number(id), item)
  }
  // per item key: the price / name the order now gives it
  const wanted = new Map<string, { price: number | null; name: string | null; label: string }>()
  for (const row of stored) {
    const incoming = incomingById.get(row.so_item_id)
    if (!incoming) continue
    const key = lineKey(row.product_id, row.outsourced_name)
    const rawPrice = incoming.unitPrice ?? incoming.unit_price
    const price = rawPrice === undefined || rawPrice === null || rawPrice === "" || !Number.isFinite(Number(rawPrice)) ? null : Number(rawPrice)
    const name = incomingName(incoming) || null
    const label = name || row.outsourced_name || key.slice(2)
    const seen = wanted.get(key)
    if (seen && ((seen.price !== null && price !== null && Math.abs(seen.price - price) > EPS) || (seen.name && name && seen.name !== name))) {
      return {
        ok: false,
        status: 409,
        error: `"${label}" is on the order more than once with different prices or names, so its delivery permit lines can't follow the edit. Give the lines the same price and name, or correct the delivery permit.`,
      }
    }
    wanted.set(key, { price: seen?.price ?? price, name: seen?.name ?? name, label })
  }
  const updates: PermitLineUpdate[] = []
  for (const line of permitLines) {
    const want = wanted.get(lineKey(line.product_id, line.item_name_snapshot))
    if (!want) continue
    const patch: PermitLineUpdate["patch"] = {}
    const qty = Number(line.quantity) || 0
    if (want.price !== null && Math.abs(want.price - (Number(line.unit_price) || 0)) > EPS) {
      patch.unit_price = want.price
      patch.total = Math.round((want.price * qty + Number.EPSILON) * 100) / 100
    }
    if (want.name && want.name !== (line.item_name_snapshot || "")) patch.item_name_snapshot = want.name
    if (Object.keys(patch).length > 0) updates.push({ itemId: Number(line.item_id), patch })
  }
  return { ok: true, updates }
}

// ---- keeping the order's line ids on an edit (owner report, 2026-11-18) ----
// Purchase-order lines (purchase_order_items.source_so_item_id), goods receipts and stored-stock holds point at an
// order line by its so_item_id, so an edit must change a line IN PLACE: a line that is still on the order keeps its
// id, only a truly new line is inserted and only a removed line is deleted. A PO line that pointed at a removed line
// is left as it is.

const lineIdOf = (item: any): number | null => {
  const raw = item?.id ?? item?.so_item_id ?? item?.soItemId
  if (raw === undefined || raw === null || raw === "") return null
  const id = Number(raw)
  return Number.isInteger(id) && id > 0 ? id : null
}
const isNewStoredPick = (item: any) => item?.fromInventoryId !== undefined && item?.fromInventoryId !== null && item?.fromInventoryId !== ""

/**
 * Which saved line each edited line is (its so_item_id), or null for a new line. A line is matched by the id the form
 * sends; a line sent without one (an older client) takes the first not yet matched saved line of the same item (its
 * product, or the trimmed name of an outsourced line), in the saved order. An id that is not a line of this order, or
 * one sent twice, makes a new line (the second copy). A new pick from stored stock is always a new line. Pure.
 */
export function matchSoEditLines(
  stored: { so_item_id: number; product_id?: number | null; outsourced_name?: string | null; line_order?: number | null }[],
  items: any[],
): (number | null)[] {
  const saved = new Set(stored.map((r) => Number(r.so_item_id)))
  const claimed = new Set<number>()
  const matched: (number | null)[] = (items || []).map(() => null)
  const unsent: number[] = []
  ;(items || []).forEach((item, index) => {
    const id = lineIdOf(item)
    if (id === null) {
      if (!isNewStoredPick(item)) unsent.push(index)
      return
    }
    if (saved.has(id) && !claimed.has(id)) {
      claimed.add(id)
      matched[index] = id
    }
  })
  const position = (r: { line_order?: number | null }) => (r.line_order === null || r.line_order === undefined ? Number.MAX_SAFE_INTEGER : Number(r.line_order))
  const free = stored
    .filter((r) => !claimed.has(Number(r.so_item_id)))
    .sort((a, b) => position(a) - position(b) || Number(a.so_item_id) - Number(b.so_item_id))
  for (const index of unsent) {
    const key = incomingKey(items[index])
    const at = free.findIndex((r) => lineKey(r.product_id ? Number(r.product_id) : null, r.outsourced_name) === key)
    if (at < 0) continue
    matched[index] = Number(free[at].so_item_id)
    free.splice(at, 1)
  }
  return matched
}

/** The edited lines with the saved line's id on each matched line (`id`) and no id on a new one (matchSoEditLines). */
export function withSoLineIds(stored: Parameters<typeof matchSoEditLines>[0], items: any[]): any[] {
  const matched = matchSoEditLines(stored, items)
  return (items || []).map((item, index) => {
    const { id: _id, so_item_id: _soItemId, soItemId: _camel, ...rest } = item || {}
    return matched[index] === null ? rest : { ...rest, id: String(matched[index]) }
  })
}

export type SoLineSaveResult =
  | { ok: true; updatedIds: number[]; insertedIds: number[]; deletedIds: number[] }
  | { ok: false; error: string; undone: boolean }

/**
 * Writes an edit's lines: a line with the id of a saved line of this order is updated in place (it keeps its
 * so_item_id), a line without one is inserted, and the saved lines no edited line names are deleted, last. When a
 * write fails, what was written is put back (updated lines restored, inserted lines deleted); `undone` says whether
 * that worked.
 */
export async function saveSoEditLines(db: Db, soId: number, lines: { id: number | null; row: Record<string, any> }[]): Promise<SoLineSaveResult> {
  const loaded = await db.from("sales_order_items").select("*").eq("so_id", soId)
  if (loaded.error) return { ok: false, error: `load sales order items: ${loaded.error.message || loaded.error}`, undone: true }
  const before = (loaded.data || []) as any[]
  const beforeById = new Map(before.map((r) => [Number(r.so_item_id), r]))
  const updatedIds: number[] = []
  const insertedIds: number[] = []
  const keep = new Set<number>()

  const undo = async (): Promise<boolean> => {
    let ok = true
    for (const id of insertedIds) {
      const { error } = await db.from("sales_order_items").delete().eq("so_item_id", id)
      if (error) ok = false
    }
    for (const id of updatedIds) {
      const { so_item_id: _id, ...old } = beforeById.get(id)
      const { error } = await db.from("sales_order_items").update(old).eq("so_item_id", id)
      if (error) ok = false
    }
    return ok
  }
  const fail = async (what: string, error: any): Promise<SoLineSaveResult> => {
    const undone = await undo()
    return { ok: false, error: `${what}: ${error?.message || error}`, undone }
  }

  for (const line of lines) {
    if (line.id !== null && beforeById.has(line.id) && !keep.has(line.id)) {
      keep.add(line.id)
      const { error } = await db.from("sales_order_items").update(line.row).eq("so_item_id", line.id).eq("so_id", soId)
      if (error) return fail("update order line", error)
      updatedIds.push(line.id)
    } else {
      const { data, error } = await db.from("sales_order_items").insert(line.row).select("so_item_id")
      if (error) return fail("add order line", error)
      for (const r of data || []) insertedIds.push(Number(r.so_item_id))
    }
  }
  const deletedIds = before.map((r) => Number(r.so_item_id)).filter((id) => !keep.has(id))
  if (deletedIds.length > 0) {
    const { error } = await db.from("sales_order_items").delete().in("so_item_id", deletedIds)
    if (error) return fail("remove order line", error)
  }
  return { ok: true, updatedIds, insertedIds, deletedIds }
}
