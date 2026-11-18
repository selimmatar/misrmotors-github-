// A sales order line taken from free stored stock (an outsourced item in a warehouse, lib/outsourced-hold.ts) is saved
// as an outsourced line whose outsourced_description is this marker:
//   "From stock (inventory #<reserved row>, from #<picked row>)"
// The reserved row is the inventory row held for the line (the picked row itself, or the part split off it); the
// picked row is what the screen offered (an edit saved twice is recognised by it). The line is already in hand, so it
// is never offered for a purchase order. No server imports: used by the screens too.
export const fromStockDescription = (reservedId: number | string, pickedId: number | string = reservedId) =>
  `From stock (inventory #${reservedId}, from #${pickedId})`

/** The reserved and picked inventory ids of a from-stock line, or null for any other line. */
export function parseFromStock(description: unknown): { reservedId: number; pickedId: number } | null {
  const m = /^From stock \(inventory #(\d+)(?:, from #(\d+))?\)$/.exec(String(description ?? "").trim())
  return m ? { reservedId: Number(m[1]), pickedId: Number(m[2] ?? m[1]) } : null
}

/** The reserved inventory id of a from-stock line, or null. */
export const fromStockInventoryId = (description: unknown): number | null => parseFromStock(description)?.reservedId ?? null

/** True for a from-stock line (snake_case database row or camelCase API item). */
export const isFromStockLine = (item: any): boolean =>
  parseFromStock(item?.outsourced_description ?? item?.outsourcedDescription) !== null
