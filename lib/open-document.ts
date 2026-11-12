// Open a document on another screen (owner request, 2026-11-12: click a DP or PO in the order overview and land on
// it). The overview remembers which document to show, then switches screen with the existing
// "navigate-to-module" event; the target screen takes the request once when it opens (searches for the number and,
// for a delivery permit, opens its details). Kept in memory only: a refresh simply forgets it.
export type DocumentScreen = "delivery-permits" | "purchase-orders"

let pending: { screen: DocumentScreen; number: string; at: number } | null = null
const MAX_AGE_MS = 60_000

export function openDocument(screen: DocumentScreen, number: string): void {
  pending = { screen, number, at: Date.now() }
  window.dispatchEvent(new CustomEvent("navigate-to-module", { detail: screen }))
}

/** The document number asked for on this screen, once; null when there is none (or it is over a minute old). */
export function takeDocumentFor(screen: DocumentScreen, now = Date.now()): string | null {
  if (!pending || pending.screen !== screen) return null
  const { number, at } = pending
  pending = null
  return now - at <= MAX_AGE_MS ? number : null
}
