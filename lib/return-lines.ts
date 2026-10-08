// Returned-quantity helpers shared by the returns API, the delivery-permit calculations, Missing Items and
// invoicing (Batch 2). Pure functions plus one loader; it deliberately imports nothing else from lib/ so that
// invoicing.ts can depend on it without a cycle.
//
// A "valid" return line is any return_items row of a product_returns row whose permit_id equals the delivery
// permit id (as text) and whose status is not `rejected`. Rejected returns never consume quantity. Historical
// returns carry permit_id = "RET-<timestamp>" and therefore never match a delivery permit: they are ignored on
// purpose (their DP relationship cannot be proven).

// Same line matching as isSOFullyDelivered in the delivery-permits route: by product, else by name.
export const lineKey = (productId: number | null | undefined, name: string | null | undefined) =>
  productId ? `p:${productId}` : `n:${(name || "").trim()}`

export const REJECTED_RETURN_STATUS = "rejected"

/** Delivery-permit statuses where goods have left the warehouse: returns can be raised against these. */
export const DELIVERED_PERMIT_STATUSES = ["OUT_FOR_DELIVERY", "SUBMITTED_SIGNED", "APPROVED"]

/**
 * How much of a line the customer is still expected to keep (and so can still be billed), given
 *   ordered  - quantity currently on the sales order,
 *   delivered - gross quantity that left on delivery permits,
 *   returned - valid (non-rejected) returned quantity:
 *     pool = min(ordered, max(ordered, delivered) - returned)  (never below zero)
 * - ordered >= delivered: units returned come off what is still to be fulfilled/billed (ordered - returned) until
 *   they are delivered again;
 * - the order was edited down to what the customer kept (ordered < delivered): the edit already absorbed the
 *   returned units, so the pool is what was kept (delivered - returned), capped at the order.
 */
export const invoiceablePool = (ordered: number, delivered: number, returned: number) =>
  Math.max(0, Math.min(ordered, Math.max(ordered, delivered) - returned))

export interface ReturnLine {
  return_id: number
  permit_id: number
  key: string
  quantity: number
  /** product_returns.created_at */
  created_at: string | null
}

type Db = any // supabase-js client (or a test double)
const must = (result: any, what: string): any => {
  if (result.error) throw new Error(`${what}: ${result.error.message || result.error}`)
  return result.data
}

// Timestamps arrive as timestamptz ("...+00:00") from product_returns and as timestamp-without-zone
// ("2026-10-08T12:00:00.123", UTC session) from accounts_receivable. Normalise both to epoch ms.
export function toMs(ts: string | null | undefined): number {
  if (!ts) return Number.NaN
  let s = String(ts).trim().replace(" ", "T")
  const timePart = s.slice(10)
  if (/[+-]\d{2}$/.test(timePart)) s += ":00"
  else if (!/(Z|[+-]\d{2}:?\d{2})$/i.test(timePart)) s += "Z"
  return Date.parse(s)
}

/** Valid (non-rejected) return lines for the given delivery permits. Throws on any query error. */
export async function loadReturnLines(db: Db, permitIds: number[]): Promise<ReturnLine[]> {
  const ids = [...new Set(permitIds.filter((id) => Number.isInteger(id)))]
  if (ids.length === 0) return []
  const returns = must(
    await db
      .from("product_returns")
      .select("return_id, permit_id, status, created_at")
      .in("permit_id", ids.map(String))
      .neq("status", REJECTED_RETURN_STATUS),
    "load returns",
  ) as any[]
  if (returns.length === 0) return []
  const items = must(
    await db
      .from("return_items")
      .select("return_id, product_id, product_name, returned_quantity")
      .in("return_id", returns.map((r) => r.return_id)),
    "load return items",
  ) as any[]
  const byId = new Map(returns.map((r) => [r.return_id, r]))
  return items
    .filter((i) => byId.has(i.return_id))
    .map((i) => {
      const ret = byId.get(i.return_id)
      return {
        return_id: i.return_id,
        permit_id: Number(ret.permit_id),
        key: lineKey(i.product_id, i.product_name),
        quantity: Number(i.returned_quantity) || 0,
        created_at: ret.created_at ?? null,
      }
    })
}

export interface ReturnedFilter {
  /** only returns against this delivery permit */
  permitId?: number
  /** only returns created at or before this instant (epoch ms). Lines without a timestamp are excluded. */
  asOfMs?: number
  /** only returns with an id <= this one (used by the post-insert race check) */
  maxReturnId?: number
}

/** Sum of returned quantity per line key. */
export function returnedByKey(lines: ReturnLine[], filter: ReturnedFilter = {}): Map<string, number> {
  const map = new Map<string, number>()
  for (const line of lines) {
    if (filter.permitId !== undefined && line.permit_id !== filter.permitId) continue
    if (filter.maxReturnId !== undefined && line.return_id > filter.maxReturnId) continue
    if (filter.asOfMs !== undefined) {
      const ms = toMs(line.created_at)
      if (Number.isNaN(ms) || ms > filter.asOfMs) continue
    }
    map.set(line.key, (map.get(line.key) || 0) + line.quantity)
  }
  return map
}

/**
 * Net quantity of each line once `returned` (per key) is taken off. When several lines share a key (a permit
 * can list the same product twice) the returned quantity is applied to them in order. Never negative.
 */
export function netLineQuantities(lines: { key: string; quantity: number }[], returned: Map<string, number>): number[] {
  const left = new Map(returned)
  return lines.map((line) => {
    const qty = Number(line.quantity) || 0
    const take = Math.min(left.get(line.key) || 0, qty)
    if (take > 0) left.set(line.key, (left.get(line.key) || 0) - take)
    return qty - take
  })
}

/** Total returned quantity per delivery permit id. */
export function returnedTotalsByPermit(lines: ReturnLine[]): Map<number, number> {
  const map = new Map<number, number>()
  for (const line of lines) map.set(line.permit_id, (map.get(line.permit_id) || 0) + line.quantity)
  return map
}

/**
 * Take returned quantity off "delivered / added to a permit" totals kept per product id and per outsourced name
 * (the shape isSOFullyDelivered and Missing Items use). Mutates and returns the maps; the result can go below zero,
 * callers clamp where they need to.
 */
export function subtractReturns(byProduct: Map<number, number>, byName: Map<string, number>, lines: ReturnLine[]) {
  for (const line of lines) {
    if (line.key.startsWith("p:")) {
      const productId = Number(line.key.slice(2))
      byProduct.set(productId, (byProduct.get(productId) || 0) - line.quantity)
    } else {
      const name = line.key.slice(2)
      if (name) byName.set(name, (byName.get(name) || 0) - line.quantity)
    }
  }
  return { byProduct, byName }
}
