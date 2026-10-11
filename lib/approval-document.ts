// What the order details show for sales_orders.approval_document_url.
// "document://..." values were written while uploads went to a Supabase bucket that does not exist: the file
// itself was never stored, so there is nothing to open.
export type ApprovalDocumentState = { kind: "link"; href: string } | { kind: "missing" } | { kind: "none" }

export function approvalDocumentState(url: string | null | undefined): ApprovalDocumentState {
  const value = (url || "").trim()
  if (/^https?:\/\//i.test(value)) return { kind: "link", href: value }
  if (value.startsWith("document://")) return { kind: "missing" }
  return { kind: "none" }
}
