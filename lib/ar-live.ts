// A customer invoice reversed on the portal and then corrected is kept for history with status "replaced"
// (spec §6.5a). From that moment it no longer counts anywhere: balances, ageing, statements, reports, dashboards,
// pending counts, "already invoiced" / over-invoicing checks, collections and payment schedules. Readers that total,
// count or allow a payment on accounts_receivable add `excludeReplaced`; lists a person reads to see history (the
// receivables list, the invoice's own PDF) show the row on purpose.
//
// Every status the CHECK allows except "replaced" (the CHECK also allows NULL, and PostgREST's `neq` would drop those
// rows, so the filter keeps them).
export const LIVE_AR_STATUSES = ["pending", "partially_paid", "paid", "overdue"] as const
export const REPLACED_AR_STATUS = "replaced"

/** `accounts_receivable` query -> the same query without replaced invoices (rows with no status are kept). */
export function excludeReplaced<T>(query: T): T {
  return (query as any).or(`status.is.null,status.neq.${REPLACED_AR_STATUS}`)
}

export const isReplacedInvoice = (row: { status?: string | null } | null | undefined): boolean => row?.status === REPLACED_AR_STATUS

export const REPLACED_PAYMENT_MESSAGE = "This invoice has been replaced by a corrected invoice. Record payments on the new invoice."
