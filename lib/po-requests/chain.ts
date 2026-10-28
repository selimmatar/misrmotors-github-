// The chain quotation -> price request (PR) -> sales order -> purchase order, from any one of them, so each page can
// show "Q-0031 -> PR-0007 -> SO-0045 -> PO-0028". Every link is optional: a quotation without a PR, a PO without a PR.
// PRs reach a quotation (sales_quotation_id) and/or a sales order (so_id); POs reach a PR through po_request_id.
type Db = { from: (table: string) => any }

export interface ChainRef {
  id: number
  number: string
}
export interface Chain {
  quotation: ChainRef | null
  prs: (ChainRef & { status: string })[]
  so: ChainRef | null
  pos: ChainRef[]
}
export type ChainStart = { quotationId: number } | { prId: number } | { soId: number } | { poId: number }

async function rows(query: any): Promise<any[]> {
  const { data, error } = await query
  if (error) throw error
  return data || []
}

export async function loadChain(db: Db, start: ChainStart): Promise<Chain> {
  let quotationId: number | null = null
  let soId: number | null = null
  const prIds = new Set<number>()

  if ("poId" in start) {
    const [po] = await rows(db.from("purchase_orders").select("po_id, po_request_id").eq("po_id", start.poId))
    if (po?.po_request_id) prIds.add(Number(po.po_request_id))
  } else if ("prId" in start) {
    prIds.add(start.prId)
  } else if ("soId" in start) {
    soId = start.soId
  } else {
    quotationId = start.quotationId
  }

  // A PR names its quotation and (once converted) its sales order.
  if (prIds.size > 0) {
    const [pr] = await rows(db.from("po_requests").select("request_id, sales_quotation_id, so_id").in("request_id", [...prIds]))
    quotationId = pr?.sales_quotation_id ?? null
    soId = pr?.so_id ?? null
  }
  // A sales order names the quotation it came from; a quotation finds the order made from it.
  if (soId !== null && quotationId === null) {
    const [so] = await rows(db.from("sales_orders").select("so_id, parent_quotation_id").eq("so_id", soId))
    quotationId = so?.parent_quotation_id ?? null
  }
  let so: ChainRef | null = null
  if (soId !== null) {
    const [row] = await rows(db.from("sales_orders").select("so_id, so_number").eq("so_id", soId))
    if (row) so = { id: row.so_id, number: row.so_number }
  } else if (quotationId !== null) {
    const [row] = await rows(
      db.from("sales_orders").select("so_id, so_number").eq("parent_quotation_id", quotationId).order("so_id", { ascending: true }).limit(1),
    )
    if (row) so = { id: row.so_id, number: row.so_number }
  }
  let quotation: ChainRef | null = null
  if (quotationId !== null) {
    const [row] = await rows(db.from("sales_quotations").select("id, quotation_number").eq("id", quotationId))
    if (row) quotation = { id: row.id, number: row.quotation_number }
  }

  // All the PRs of this quotation / sales order (a PR made straight from a PO screen has neither: just itself).
  const prRows = new Map<number, any>()
  const addPrs = (list: any[]) => list.forEach((r) => prRows.set(r.request_id, r))
  const prColumns = "request_id, request_number, status"
  if (quotation) addPrs(await rows(db.from("po_requests").select(prColumns).eq("sales_quotation_id", quotation.id)))
  if (so) addPrs(await rows(db.from("po_requests").select(prColumns).eq("so_id", so.id)))
  if (prIds.size > 0) addPrs(await rows(db.from("po_requests").select(prColumns).in("request_id", [...prIds])))
  const prs = [...prRows.values()]
    .sort((a, b) => a.request_id - b.request_id)
    .map((r) => ({ id: r.request_id, number: r.request_number, status: r.status }))

  const pos =
    prs.length === 0
      ? []
      : (await rows(db.from("purchase_orders").select("po_id, po_number").in("po_request_id", prs.map((p) => p.id))))
          .sort((a, b) => a.po_id - b.po_id)
          .map((r) => ({ id: r.po_id, number: r.po_number }))

  return { quotation, prs, so, pos }
}

/** chainText for a print: a failed lookup prints no chain line rather than failing the document. */
export async function chainTextForPrint(db: Db, start: ChainStart): Promise<string> {
  try {
    return chainText(await loadChain(db, start))
  } catch (error) {
    console.error("Could not load the document chain for a print:", error)
    return ""
  }
}

/** "Q-0031 → PR-0007 → SO-0045 → PO-0028"; empty when there is nothing to link. */
export function chainText(chain: Chain): string {
  const parts = [chain.quotation?.number, ...chain.prs.map((p) => p.number), chain.so?.number, ...chain.pos.map((p) => p.number)].filter(
    (p): p is string => Boolean(p),
  )
  return parts.length > 1 ? parts.join(" → ") : ""
}
