// Delivery-permit actions and the statuses each one may start from (PUT /api/delivery-permits).
// Lifecycle: DRAFT -> READY_FOR_SHIPMENT -> (PRINTED) -> READY_FOR_PICKUP -> OUT_FOR_DELIVERY -> SUBMITTED_SIGNED -> APPROVED,
// plus REJECTED. The sets below are the statuses each action may start from:
//  - delivery-permit-card: MARK_PRINTED from DRAFT (printing), MARK_READY_FOR_PICKUP / MARK_OUT_FOR_DELIVERY only where
//    the preparation rule below allows it, MARK_SUBMITTED_SIGNED from OUT_FOR_DELIVERY, APPROVE / REJECT from SUBMITTED_SIGNED;
//  - warehouse-delivery-module: ALLOCATE_WAREHOUSES from DRAFT / PRINTED, MARK_READY_FOR_PICKUP from READY_FOR_SHIPMENT;
//  - shipping-module: MARK_OUT_FOR_DELIVERY from READY_FOR_PICKUP (or a direct-from-supplier permit), MARK_SUBMITTED_SIGNED
//    from OUT_FOR_DELIVERY.
//  - approval (card / delivery-permits review): SEND_BACK_TO_SHIPPING from SUBMITTED_SIGNED (wrong / unclear upload) or
//    from an uninvoiced REJECTED permit -> OUT_FOR_DELIVERY with "re-upload needed" and the reason.
// An APPROVED permit is refused earlier by the DP_ALREADY_APPROVED guard.
//
// WAREHOUSE PREPARATION (owner rule, 2026-11-22): every permit goes through the warehouse (ALLOCATE_WAREHOUSES ->
// READY_FOR_SHIPMENT -> MARK_READY_FOR_PICKUP) before it can be shipped, except a permit whose lines all go straight
// from the supplier to the customer (never in our warehouse). Printing a draft is still allowed, but a printed permit
// that was not prepared cannot be shipped. Per line (lineRoute):
//   - a catalogue product                         -> warehouse
//   - an outsourced line our inventory holds stock of for this order (inventory.so_number + outsourced_name, quantity
//     > 0), or that was received into a warehouse, or that already has a warehouse on the permit -> warehouse
//   - any other outsourced line                   -> direct from the supplier
import { excludeReplaced } from "./ar-live"

const NON_FINAL = ["DRAFT", "READY_FOR_SHIPMENT", "PRINTED", "READY_FOR_PICKUP", "OUT_FOR_DELIVERY", "SUBMITTED_SIGNED"] as const

export const DP_ACTION_FROM: Record<string, readonly string[]> = {
  ALLOCATE_WAREHOUSES: ["DRAFT", "READY_FOR_SHIPMENT", "PRINTED"],
  MARK_READY_FOR_PICKUP: ["DRAFT", "READY_FOR_SHIPMENT", "PRINTED"],
  MARK_PRINTED: ["DRAFT", "READY_FOR_SHIPMENT"],
  MARK_OUT_FOR_DELIVERY: ["DRAFT", "PRINTED", "READY_FOR_PICKUP"],
  MARK_SUBMITTED_SIGNED: ["OUT_FOR_DELIVERY"],
  APPROVE: ["SUBMITTED_SIGNED", "APPROVED"], // APPROVED -> APPROVE is the existing idempotent repeat
  REJECT: NON_FINAL,
  // Wrong / unclear signed upload (owner rule, 2026-11-24): the approver sends a signed permit back to shipping to upload
  // again (back to OUT_FOR_DELIVERY, lines and stock kept); an already REJECTED permit that was not invoiced can be sent
  // back the same way (accountant / CEO / admin; the route checks the invoice and the role).
  SEND_BACK_TO_SHIPPING: ["SUBMITTED_SIGNED", "REJECTED"],
}

/** Roles that may send a permit back to shipping for a new upload. */
export const SEND_BACK_ROLES = ["accountant", "ceo", "admin"] as const

/** A permit that is out for delivery again because its signed upload was sent back (the reason is kept on it). */
export const needsReupload = (permit: { status?: string | null; rejection_reason?: string | null; needs_reupload?: boolean | null }) =>
  permit.status === "OUT_FOR_DELIVERY" && (permit.needs_reupload === true || (permit.needs_reupload !== false && !!permit.rejection_reason))

/** True when `action` may run on a permit currently in `from`. Actions not listed (UPDATE_DETAILS, unknown) are not guarded here. */
export function isAllowedDpTransition(from: string, action: string): boolean {
  const allowed = DP_ACTION_FROM[action]
  return !allowed || allowed.includes(from)
}

export type DpLineRoute = "warehouse" | "direct"

/** Outsourced names compared without case and extra spaces. */
export const sameDpName = (v: unknown) => String(v ?? "").trim().replace(/\s+/g, " ").toLowerCase()

/** Where one permit line comes from: our warehouse, or straight from the supplier. */
export function lineRoute(
  line: { product_id?: unknown; item_name_snapshot?: unknown; warehouse_id?: unknown },
  warehouseNames: ReadonlySet<string>,
): DpLineRoute {
  if (line.product_id) return "warehouse"
  if (line.warehouse_id) return "warehouse"
  return warehouseNames.has(sameDpName(line.item_name_snapshot)) ? "warehouse" : "direct"
}

/** A permit needs warehouse preparation when any of its lines comes from our warehouse. */
export const needsPreparation = (routes: readonly DpLineRoute[]) => routes.some((r) => r === "warehouse")

/** Prepared = allocated in the warehouse (READY_FOR_SHIPMENT and on, or printed after allocation). */
export const isPrepared = (permit: { status?: string | null; allocated_at?: string | null }) =>
  ["READY_FOR_SHIPMENT", "READY_FOR_PICKUP", "OUT_FOR_DELIVERY", "SUBMITTED_SIGNED", "APPROVED"].includes(String(permit.status)) || !!permit.allocated_at

export interface DpRefusal {
  code: string
  error: string
  errorAr: string
}

/**
 * Why the preparation rule refuses this action on this permit, or null. `needsWarehouse` = needsPreparation of its lines.
 *  - MARK_READY_FOR_PICKUP: a permit with warehouse lines must be allocated first (ALLOCATE_WAREHOUSES);
 *  - MARK_OUT_FOR_DELIVERY: a permit with warehouse lines must be READY_FOR_PICKUP; a direct permit may go from
 *    DRAFT / PRINTED / READY_FOR_PICKUP.
 */
export function preparationRefusal(
  permit: { status?: string | null; allocated_at?: string | null; permit_no?: string | null },
  action: string,
  needsWarehouse: boolean,
): DpRefusal | null {
  if (!needsWarehouse) return null
  const no = permit.permit_no || "This permit"
  if (action === "MARK_READY_FOR_PICKUP" && !isPrepared(permit)) {
    return {
      code: "DP_NOT_PREPARED",
      error: `${no} has items from our warehouse. The warehouse must prepare it first (choose the warehouses), then it can be ready for pickup.`,
      errorAr: `${no} فيه أصناف من مخزننا. لازم المخزن يجهّزه الأول (يختار المخازن)، وبعدها يبقى جاهز للاستلام.`,
    }
  }
  if (action === "MARK_OUT_FOR_DELIVERY" && permit.status !== "READY_FOR_PICKUP") {
    return {
      code: "DP_NOT_PREPARED",
      error: `${no} has items from our warehouse, so it cannot go out yet. The warehouse must prepare it and mark it ready for pickup first.`,
      errorAr: `${no} فيه أصناف من مخزننا، فلا يمكن أن يخرج للتسليم الآن. لازم المخزن يجهّزه ويعلّمه جاهز للاستلام الأول.`,
    }
  }
  return null
}

/** The next steps a permit may take, for the screens (only what the server will also allow). */
export function allowedDpActions(permit: { status?: string | null; allocated_at?: string | null }, needsWarehouse: boolean): string[] {
  return Object.keys(DP_ACTION_FROM).filter(
    (action) => isAllowedDpTransition(String(permit.status), action) && !preparationRefusal(permit, action, needsWarehouse),
  )
}

type Db = any

const must = (result: any, what: string): any => {
  if (result.error) throw new Error(`${what}: ${result.error.message || result.error}`)
  return result.data
}

/**
 * The outsourced names that are (or were) in our warehouse for each sales order: inventory rows stored for the order
 * (so_number + outsourced_name, quantity > 0) and goods-receipt lines of the order's lines received into a warehouse.
 */
export async function warehouseNamesBySo(db: Db, soIds: number[]): Promise<Map<number, Set<string>>> {
  const out = new Map<number, Set<string>>()
  const ids = [...new Set(soIds.filter((id) => Number.isInteger(id) && id > 0))]
  if (ids.length === 0) return out
  for (const id of ids) out.set(id, new Set())
  const orders = must(await db.from("sales_orders").select("so_id, so_number").in("so_id", ids), "load sales orders") as any[]
  const soByNumber = new Map(orders.filter((o) => o.so_number).map((o) => [String(o.so_number), Number(o.so_id)]))
  if (soByNumber.size > 0) {
    const stored = must(
      await db.from("inventory").select("so_number, outsourced_name, quantity").eq("is_outsourced", true).in("so_number", [...soByNumber.keys()]),
      "load stored outsourced items",
    ) as any[]
    for (const r of stored) {
      if (!((Number(r.quantity) || 0) > 0) || r.is_returned === true) continue
      const so = soByNumber.get(String(r.so_number))
      if (so) out.get(so)!.add(sameDpName(r.outsourced_name))
    }
  }
  const soItems = must(await db.from("sales_order_items").select("so_item_id, so_id").in("so_id", ids), "load sales order items") as any[]
  const soOfItem = new Map(soItems.map((i) => [Number(i.so_item_id), Number(i.so_id)]))
  if (soOfItem.size > 0) {
    const received = must(
      await db.from("goods_receipt_lines").select("source_so_item_id, outsourced_name, warehouse_id, quantity_received").in("source_so_item_id", [...soOfItem.keys()]),
      "load goods receipts",
    ) as any[]
    for (const r of received) {
      if (!r.warehouse_id || !((Number(r.quantity_received) || 0) > 0) || !r.outsourced_name) continue
      const so = soOfItem.get(Number(r.source_so_item_id))
      if (so) out.get(so)!.add(sameDpName(r.outsourced_name))
    }
  }
  return out
}

/** The route of each line of one permit (in the order given). */
export async function permitLineRoutes(db: Db, permit: { permit_id: number; sales_order_id?: number | null }, lines?: any[]): Promise<DpLineRoute[]> {
  const rows =
    lines ??
    (must(
      await db.from("delivery_permit_items").select("item_id, product_id, item_name_snapshot, warehouse_id, quantity").eq("permit_id", permit.permit_id),
      "load permit items",
    ) as any[])
  const outsourced = rows.some((l) => !l.product_id && !l.warehouse_id)
  const names = outsourced && permit.sales_order_id ? (await warehouseNamesBySo(db, [Number(permit.sales_order_id)])).get(Number(permit.sales_order_id)) || new Set<string>() : new Set<string>()
  return rows.map((l) => lineRoute(l, names))
}

/**
 * True when the permit is on an invoice (invoice_delivery_permits, or a single-permit invoice's
 * source_delivery_permit_id). Such a permit is never sent back to shipping. Throws when it cannot be checked.
 */
export async function permitInvoiced(db: Db, permitId: number): Promise<boolean> {
  const links = must(await db.from("invoice_delivery_permits").select("invoice_id").eq("permit_id", permitId), "check invoice links") as any[]
  if (links.length > 0) return true
  // a replaced / cancelled invoice no longer bills the permit (lib/ar-live.ts)
  const own = must(
    await excludeReplaced(db.from("accounts_receivable").select("invoice_id, status").eq("source_delivery_permit_id", permitId)),
    "check invoices",
  ) as any[]
  return own.length > 0
}
