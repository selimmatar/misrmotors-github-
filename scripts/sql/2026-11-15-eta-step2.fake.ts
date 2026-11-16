// FakeDb stand-ins for the SQL functions in 2026-11-15-eta-step2.sql (correct and reissue, task 7). Each mirrors its
// SQL function step by step; one call is one transaction (a refusal restores every table as it was). Tests install
// them with installReissueRpcs(db) and exercise them through lib/invoicing.ts exactly as the server calls the real
// functions (db.rpc). Keep this file in step with the SQL.
import type { FakeDb, Row } from "../../lib/__tests__/fake-db"
import { computeArStatus } from "../../lib/ar-status"

const raise = (hint: string, message: string) => {
  throw { code: "P0001", message, hint, details: null }
}
const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100
const intOrNull = (v: unknown) => (v === null || v === undefined || v === "" ? null : Number.parseInt(String(v), 10))
const isReceivableSchedule = (s: Row) => (s.schedule_type ?? "") !== "payable" && !(s.po_id != null && s.so_id == null)
const today = () => new Date().toISOString().slice(0, 10)
const plusDays = (days: number) => new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10)

/** Runs `body` as one transaction: anything it throws restores the tables and sequences. */
function atomic<T>(db: FakeDb, body: () => T): T {
  const tables = db.snapshot()
  const seq = { ...db.seq }
  try {
    return body()
  } catch (e) {
    db.tables = tables
    db.seq = seq
    throw e
  }
}

function insertRow(db: FakeDb, table: string, pk: string, row: Row): Row {
  const item: Row = { ...row, [pk]: ++db.seq[table] }
  db.tables[table] ||= []
  db.tables[table].push(item)
  return item
}

export function etaReissueInvoice(db: FakeDb, args: { p_old: number; p_new_row: Row; p_permit_ids: number[] | null; p_confirm_overpaid?: boolean }): number {
  return atomic(db, () => {
    const t = (name: string) => (db.tables[name] ||= [])
    const row = args.p_new_row || {}
    const permits = args.p_permit_ids || []
    const customer = intOrNull(row.customer_id)
    const amount = row.amount === null || row.amount === undefined || row.amount === "" ? null : round2(Number(row.amount))
    const due = row.due_date || plusDays(30)
    if (amount === null || !(amount > 0)) raise("REISSUE_BAD_ROW", "The new invoice has no amount.")
    const old = t("accounts_receivable").find((r) => r.invoice_id === args.p_old)
    if (!old || old.status !== "replaced" || old.replaced_by_invoice_id != null) raise("REISSUE_NOT_OPEN", `Invoice ${args.p_old} is not open for correction.`)
    const links = t("invoice_delivery_permits")
    if (links.some((l) => permits.includes(l.permit_id) && l.invoice_id !== args.p_old))
      raise("REISSUE_PERMIT_TAKEN", "A delivery permit of the new invoice is already invoiced.")
    if (permits.length > 0 && links.some((l) => l.invoice_id === args.p_old && !permits.includes(l.permit_id)))
      raise("REISSUE_MISSING_PERMITS", `The new invoice must include every delivery permit of invoice ${old!.invoice_number}.`)

    const oldLinked = links.some((l) => l.invoice_id === args.p_old)
    if (permits.length > 0 && !oldLinked && t("delivery_permits").some((d) => d.sales_order_id === old!.so_id && d.status !== "REJECTED" && !permits.includes(d.permit_id)))
      raise("REISSUE_MISSING_PERMITS", `The new invoice must include every delivery permit of invoice ${old!.invoice_number}.`)
    // P14: the return credits of the old invoice's permits (all the order's permits for a whole-order invoice)
    const retPermits = (oldLinked ? links.filter((l) => l.invoice_id === args.p_old).map((l) => l.permit_id) : t("delivery_permits").filter((d) => d.sales_order_id === old!.so_id).map((d) => d.permit_id)).map(String)
    const retIds = t("product_returns").filter((r) => retPermits.includes(String(r.permit_id))).map((r) => r.return_id)
    const returnCredits = t("customer_credits").filter((c) => c.credit_type === "sales_return" && c.reference_type === "product_return" && retIds.includes(c.reference_id))
    if (returnCredits.some((c) => c.status !== "active")) raise("REISSUE_RETURN_CREDIT_USED", "A return credit from this invoice was already used. Un-apply it first.")

    const collected = round2(Number(old!.collected_amount) || 0)
    const hasPayments =
      collected > 0.005 || t("customer_payments").some((p) => p.invoice_id === args.p_old) || t("customer_credits").some((c) => c.used_in_invoice_id === args.p_old)
    if (hasPayments && customer !== (old!.customer_id ?? null)) {
      const name = t("customers").find((c) => c.customer_id === old!.customer_id)?.customer_name
      raise("PAYMENTS_OTHER_CUSTOMER", `This invoice has payments from ${name ?? "another customer"}. Move or refund them first`)
    }
    const excess = Math.max(round2(collected - amount!), 0)
    if (excess > 0.005 && args.p_confirm_overpaid !== true)
      raise("REISSUE_OVERPAID", `The payments (${collected}) exceed the new invoice (${amount}). Confirm to keep ${excess} as customer credit.`)
    if (excess > 0.005 && customer === null)
      raise("REISSUE_OVERPAID_NO_CUSTOMER", "The new invoice has no customer, so the extra payment cannot be kept as customer credit.")
    const newCollected = Math.min(collected, amount!)
    const status = computeArStatus({ amount, collectedAmount: newCollected, dueDate: due })

    const number = row.invoice_number
    if (t("accounts_receivable").some((r) => r.invoice_number === number)) throw { code: "23505", message: "duplicate key (invoice_number)" }
    const created = insertRow(db, "accounts_receivable", "invoice_id", {
      invoice_number: number,
      customer_id: customer,
      so_id: intOrNull(row.so_id),
      source_delivery_permit_id: intOrNull(row.source_delivery_permit_id),
      invoice_date: row.invoice_date || today(),
      due_date: due,
      amount,
      collected_amount: newCollected,
      balance: round2(amount! - newCollected),
      payment_terms: row.payment_terms ?? null,
      installment_months: intOrNull(row.installment_months) ?? 1,
      months_paid: old!.months_paid || 0,
      status,
      replaces_invoice_id: args.p_old,
      replaced_by_invoice_id: null,
      created_at: db.stamp(),
    })
    const newId = created.invoice_id as number

    for (const l of links) if (l.invoice_id === args.p_old && permits.includes(l.permit_id)) l.invoice_id = newId
    for (const p of permits) {
      if (links.some((l) => l.permit_id === p)) {
        if (!links.some((l) => l.permit_id === p && l.invoice_id === newId)) raise("REISSUE_PERMIT_TAKEN", "A delivery permit of the new invoice was invoiced by another request.")
        continue
      }
      links.push({ invoice_id: newId, permit_id: p })
    }
    for (const p of t("delivery_permits")) if (permits.includes(p.permit_id)) p.invoice_id = newId

    for (const p of t("customer_payments")) if (p.invoice_id === args.p_old) p.invoice_id = newId
    for (const s of t("payment_schedules")) if (s.invoice_id === args.p_old && isReceivableSchedule(s)) s.invoice_id = newId
    for (const c of t("customer_credits")) if (c.used_in_invoice_id === args.p_old) c.used_in_invoice_id = newId
    for (const c of returnCredits) {
      Object.assign(c, {
        status: "used", used_at: new Date(db.clock).toISOString(), used_in_invoice_id: newId,
        notes: [c.notes || null, `Settled by corrected invoice ${number}: it bills the returned goods less`].filter(Boolean).join(" | "),
      })
    }
    if (excess > 0.005) {
      const note = `Overpayment on ${number} (moved from ${old!.invoice_number})`
      insertRow(db, "customer_credits", "credit_id", {
        customer_id: customer, amount: excess, status: "active", credit_type: "overpayment", reference_type: "eta_reissue",
        reference_id: args.p_old, invoice_id: newId, description: note, notes: note, used_in_invoice_id: null,
      })
    }
    Object.assign(old!, { replaced_by_invoice_id: newId, collected_amount: 0, months_paid: 0, balance: round2(Number(old!.amount) || 0) })
    return newId
  })
}

export function etaUndoReissue(db: FakeDb, args: { p_new: number; p_moved_permit_ids: number[] | null }): null {
  return atomic(db, () => {
    const t = (name: string) => (db.tables[name] ||= [])
    const moved = args.p_moved_permit_ids || []
    const fresh = t("accounts_receivable").find((r) => r.invoice_id === args.p_new)
    if (!fresh || fresh.replaces_invoice_id == null) raise("REISSUE_UNDO_REFUSED", `Invoice ${args.p_new} is not a reissue.`)
    const old = t("accounts_receivable").find((r) => r.invoice_id === fresh!.replaces_invoice_id)
    if (!old || old.replaced_by_invoice_id !== args.p_new) raise("REISSUE_UNDO_REFUSED", `Invoice ${args.p_new} is not the reissue of its old invoice.`)
    const ownCredits = t("customer_credits").filter((c) => c.reference_type === "eta_reissue" && c.invoice_id === args.p_new)
    if (t("eta_documents").some((d) => d.invoice_id === args.p_new) || ownCredits.some((c) => c.status !== "active"))
      raise("REISSUE_UNDO_REFUSED", `Invoice ${args.p_new} is already in use.`)
    const credit = ownCredits.reduce((s, c) => s + (Number(c.amount) || 0), 0)
    db.tables.customer_credits = t("customer_credits").filter((c) => !ownCredits.includes(c))
    const oldId = old!.invoice_id
    for (const p of t("customer_payments")) if (p.invoice_id === args.p_new) p.invoice_id = oldId
    for (const s of t("payment_schedules")) if (s.invoice_id === args.p_new && isReceivableSchedule(s)) s.invoice_id = oldId
    for (const c of t("customer_credits")) {
      if (c.used_in_invoice_id === args.p_new && c.credit_type === "sales_return" && String(c.notes || "").includes("Settled by corrected invoice ")) {
        Object.assign(c, { status: "active", used_at: null, used_in_invoice_id: null, notes: String(c.notes).replace(/( \| )?Settled by corrected invoice .*$/, "") || null })
      }
    }
    for (const c of t("customer_credits")) if (c.used_in_invoice_id === args.p_new) c.used_in_invoice_id = oldId
    const collected = round2((Number(fresh!.collected_amount) || 0) + credit)
    Object.assign(old!, { collected_amount: collected, months_paid: fresh!.months_paid || 0, replaced_by_invoice_id: null, balance: round2((Number(old!.amount) || 0) - collected) })
    db.tables.invoice_delivery_permits = t("invoice_delivery_permits").filter((l) => l.invoice_id !== args.p_new)
    for (const p of moved) db.tables.invoice_delivery_permits.push({ invoice_id: oldId, permit_id: p })
    for (const p of t("delivery_permits")) {
      if (p.invoice_id === args.p_new) p.invoice_id = null
      if (moved.includes(p.permit_id)) p.invoice_id = oldId
    }
    db.tables.accounts_receivable = t("accounts_receivable").filter((r) => r.invoice_id !== args.p_new)
    return null
  })
}

/** Registers both stand-ins on a FakeDb (db.rpc("eta_reissue_invoice" | "eta_undo_reissue", args)). */
export function installReissueRpcs(db: FakeDb): FakeDb {
  db.rpcHandlers.eta_reissue_invoice = (args) => etaReissueInvoice(db, args)
  db.rpcHandlers.eta_undo_reissue = (args) => etaUndoReissue(db, args)
  return db
}
