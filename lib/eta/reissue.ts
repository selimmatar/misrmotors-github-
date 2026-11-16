// Correct and reissue (spec §6.5a): "Correct and reissue" on an invoice reversed on the portal, and "Correct delivery
// permit" while that correction is open. The new invoice itself is made the normal way (lib/invoicing.ts), which
// recognises the reissue and moves the payments in one database transaction (lib/eta/correction.ts).
import { cancelConfirmed, type SendDeps } from "./send"
import { confirmCancelled } from "./after-send"
import { openCorrectionForPermit } from "./correction"
import { REPLACED_AR_STATUS } from "../ar-live"
import { DP_STOCK_OPERATION, dpStockKey, takeFromRow, undoMoves, type ShortLine, type StockMove } from "../dp-stock"
import { lineKey, loadReturnLines, returnedByKey } from "../return-lines"
import { markDeliveredIfComplete, reopenIfNotFullyDelivered } from "../so-edit"

type Db = any

const must = (result: any, what: string): any => {
  if (result.error) throw new Error(`${what}: ${result.error.message || result.error}`)
  return result.data
}
const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100
const EPS = 1e-6

export interface ReissueRefusal { ok: false; code: string; message: string; messageAr: string; status: number }
const refuse = (status: number, code: string, message: string, messageAr: string): ReissueRefusal => ({ ok: false, code, message, messageAr, status })

// ---- start: "Correct and reissue" -------------------------------------------------------------------------------

/**
 * Marks the invoice `replaced` (it stops counting everywhere, Task 6) and opens its sales order and delivery permits for
 * correction. Only when its real portal document is fully reversed: a `valid` credit note, or a cancellation the portal
 * confirms now (confirmCancelled, ruling P10). The permit links stay on the old invoice until the new one exists.
 */
export async function startReissue(db: Db, invoiceId: number, userId: number | null, deps: SendDeps = {}): Promise<{ ok: true } | ReissueRefusal> {
  if (!Number.isInteger(invoiceId) || invoiceId < 1) return refuse(404, "not_found", "Invoice not found.", "الفاتورة غير موجودة.")
  const invoice = must(
    await db.from("accounts_receivable").select("invoice_id, invoice_number, so_id, status, replaced_by_invoice_id").eq("invoice_id", invoiceId).maybeSingle(),
    "load invoice",
  )
  if (!invoice) return refuse(404, "not_found", "Invoice not found.", "الفاتورة غير موجودة.")
  if (invoice.status === REPLACED_AR_STATUS) {
    return refuse(409, "already_replaced", "This invoice is already being corrected or has been replaced.", "هذه الفاتورة قيد التصحيح بالفعل أو تم استبدالها.")
  }
  const links = must(await db.from("invoice_delivery_permits").select("permit_id").eq("invoice_id", invoiceId), "load invoice links") as any[]
  if (!invoice.so_id && links.length === 0) {
    return refuse(409, "not_sales_invoice", "Only an invoice of a sales order can be corrected and reissued.", "يمكن تصحيح وإعادة إصدار فواتير أوامر البيع فقط.")
  }

  const docs = (must(
    await db.from("eta_documents").select("doc_id, document_type, environment, version, status, errors").eq("invoice_id", invoiceId),
    "load e-invoice documents",
  ) as any[]).filter((d) => (d.environment || "real") === "real")
  const invoices = docs.filter((d) => d.document_type !== "C")
  const notes = docs.filter((d) => d.document_type === "C")
  // a document the customer rejected is reversed on the portal (ruling P19); a credit note can't be made for it
  let reversed = notes.some((n) => n.status === "valid") || invoices.some((d) => d.status === "rejected")
  if (!reversed) {
    // newest first; the portal must confirm the cancellation now (the customer can decline a cancellation)
    const cancelled = invoices.filter((d) => d.status === "cancelled").sort((a, b) => Number(b.version) - Number(a.version))
    for (const doc of cancelled) {
      if (await confirmCancelled(db, doc.doc_id, deps)) {
        reversed = true
        break
      }
    }
    if (!reversed) {
      if (cancelled.length > 0) {
        const confirmedEarlier = cancelled.some(cancelConfirmed)
        return refuse(
          409,
          "cancel_not_confirmed",
          confirmedEarlier
            ? "The tax portal could not confirm the cancellation just now. Try again in a minute."
            : "The tax portal has not confirmed the cancellation yet (the customer can still decline it). Try again later.",
          confirmedEarlier
            ? "تعذّر على بوابة الضرائب تأكيد الإلغاء الآن. حاول مرة أخرى بعد دقيقة."
            : "لم تؤكد بوابة الضرائب الإلغاء بعد (ما زال بإمكان العميل رفضه). حاول لاحقاً.",
        )
      }
      if (notes.some((n) => ["pending_signature", "submitted"].includes(n.status))) {
        return refuse(409, "credit_note_pending", "The credit note is not valid on the tax portal yet. Wait until it is valid.", "إشعار الدائن لم يصبح صالحاً على بوابة الضرائب بعد. انتظر حتى يصبح صالحاً.")
      }
      if (invoices.some((d) => d.status === "valid")) {
        return refuse(
          409,
          "not_reversed",
          "This invoice is still valid on the tax portal. Issue a credit note or cancel it on the portal first.",
          "هذه الفاتورة ما زالت صالحة على بوابة الضرائب. أصدر إشعار دائن أو ألغها على البوابة أولاً.",
        )
      }
      return refuse(
        409,
        "not_reversed",
        "Only an invoice reversed on the tax portal (a valid credit note, or cancelled) can be corrected and reissued.",
        "يمكن تصحيح وإعادة إصدار الفاتورة فقط بعد إلغائها على بوابة الضرائب أو إصدار إشعار دائن صالح لها.",
      )
    }
  }

  const updated = must(
    await db
      .from("accounts_receivable")
      .update({ status: REPLACED_AR_STATUS })
      .eq("invoice_id", invoiceId)
      .or(`status.is.null,status.neq.${REPLACED_AR_STATUS}`)
      .is("replaced_by_invoice_id", null)
      .select("invoice_id"),
    "mark invoice replaced",
  ) as any[]
  if (updated.length !== 1) {
    return refuse(409, "already_replaced", "This invoice is already being corrected or has been replaced.", "هذه الفاتورة قيد التصحيح بالفعل أو تم استبدالها.")
  }
  await logEvent(db, invoiceId, "ETA_CORRECTION_STARTED", `Correct and reissue started for ${invoice.invoice_number || `invoice #${invoiceId}`}`, userId)
  return { ok: true }
}

async function logEvent(db: Db, entityId: number, eventType: string, notes: string, userId: number | null, entityType = "INVOICE", value?: unknown) {
  try {
    const { error } = await db.from("workflow_events").insert({
      entity_type: entityType,
      entity_id: entityId,
      event_type: eventType,
      new_value: value === undefined ? null : JSON.stringify(value),
      notes,
      performed_by: userId,
    })
    if (error) console.error(`[reissue] could not log ${eventType}: ${error.message}`)
  } catch (e: any) {
    console.error(`[reissue] could not log ${eventType}: ${e?.message || e}`)
  }
}

// ---- "Correct delivery permit" ----------------------------------------------------------------------------------

export interface CorrectionLine { permitItemId: number; quantity: number }
/** A stock move of a correction: "out" took more from stock, "back" put stock back. */
export interface CorrectionMove extends StockMove { direction: "out" | "back" }
export type CorrectPermitResult =
  | { ok: true; correctionId: number | null; lines: { permitItemId: number; name: string; before: number; after: number }[]; stockMoves: CorrectionMove[] }
  | (ReissueRefusal & { lines?: ShortLine[] })

const MAX_CAS_ATTEMPTS = 6

/** Put `quantity` back on one inventory row (compare-and-swap). */
async function addToRow(db: Db, inventoryId: number, quantity: number): Promise<{ ok: true; before: number; after: number } | { ok: false }> {
  for (let attempt = 0; attempt < MAX_CAS_ATTEMPTS; attempt++) {
    const { data: row, error } = await db.from("inventory").select("quantity").eq("inventory_id", inventoryId).limit(1).maybeSingle()
    if (error) throw new Error(`read inventory: ${error.message}`)
    if (!row) return { ok: false }
    const before = Number(row.quantity) || 0
    const { data: updated, error: updateError } = await db
      .from("inventory")
      .update({ quantity: before + quantity, last_updated: new Date().toISOString() })
      .eq("inventory_id", inventoryId)
      .eq("quantity", before)
      .select("inventory_id")
    if (updateError) throw new Error(`update inventory: ${updateError.message}`)
    if (updated && updated.length === 1) return { ok: true, before, after: before + quantity }
  }
  return { ok: false }
}

/** Undo a correction's stock moves: "out" goes back to stock, "back" is taken out again. Returns what could not be undone. */
async function undoCorrectionMoves(db: Db, moves: CorrectionMove[]): Promise<CorrectionMove[]> {
  const failed: CorrectionMove[] = []
  const outs = moves.filter((m) => m.direction === "out")
  const notRestored = await undoMoves(db, outs)
  failed.push(...outs.filter((m) => notRestored.includes(m)))
  for (const m of moves.filter((x) => x.direction === "back")) {
    const taken = await takeFromRow(db, m.inventoryId, m.quantity)
    if (!taken.ok) failed.push(m)
  }
  return failed
}

const CORRECT_NOT_OPEN = {
  message: (no: string) => `${no} can only be corrected while its invoice is being corrected (Correct and reissue). Approved delivery permits stay locked otherwise.`,
  messageAr: (no: string) => `لا يمكن تصحيح ${no} إلا أثناء تصحيح فاتورته (تصحيح وإعادة إصدار). أذون التسليم المعتمدة تبقى مقفلة فيما عدا ذلك.`,
}

/**
 * "Correct delivery permit" (spec §6.5a, item 3): a permit typed wrong (nothing physically moved). Only for a permit of
 * an open correction. Each line's new quantity can't go below what was already returned; stock moves by the difference
 * (less -> back to stock, more -> out of stock, checked like an approval: a shortage changes nothing). Recorded in
 * dp_corrections as "Correction for invoice {old number}" with who, when, before and after. Any failure undoes what
 * was done.
 */
export async function correctPermit(db: Db, permitId: number, lines: CorrectionLine[], userId: number | null): Promise<CorrectPermitResult> {
  if (!Number.isInteger(permitId) || permitId < 1) return refuse(404, "not_found", "Delivery permit not found.", "إذن التسليم غير موجود.")
  if (!Array.isArray(lines) || lines.length === 0) return refuse(400, "no_lines", "Give at least one line to correct.", "أدخل بنداً واحداً على الأقل للتصحيح.")
  const seen = new Set<number>()
  for (const l of lines) {
    if (!Number.isInteger(l?.permitItemId) || l.permitItemId < 1 || typeof l.quantity !== "number" || !Number.isFinite(l.quantity) || l.quantity < 0 || seen.has(l.permitItemId)) {
      return refuse(400, "bad_line", "Each line needs a permit item and a quantity of 0 or more (each item once).", "كل بند يحتاج إلى صنف من الإذن وكمية صفر أو أكثر (كل صنف مرة واحدة).")
    }
    seen.add(l.permitItemId)
  }

  const permit = must(await db.from("delivery_permits").select("permit_id, permit_no, status, sales_order_id").eq("permit_id", permitId).maybeSingle(), "load delivery permit")
  if (!permit) return refuse(404, "not_found", "Delivery permit not found.", "إذن التسليم غير موجود.")
  const permitNo = permit.permit_no || `permit #${permitId}`
  const correction = await openCorrectionForPermit(db, permitId)
  if (!correction) return refuse(409, "NOT_OPEN_CORRECTION", CORRECT_NOT_OPEN.message(permitNo), CORRECT_NOT_OPEN.messageAr(permitNo))
  if (permit.status !== "APPROVED") {
    return refuse(409, "NOT_APPROVED", `${permitNo} is not approved; change it the normal way.`, `${permitNo} غير معتمد؛ عدّله بالطريقة المعتادة.`)
  }
  const oldNumber = correction.invoiceNumber || `#${correction.invoiceId}`

  const items = must(
    await db.from("delivery_permit_items").select("item_id, product_id, item_name_snapshot, quantity, unit_price, total, warehouse_id").eq("permit_id", permitId),
    "load delivery permit items",
  ) as any[]
  const changes: { item: any; before: number; after: number; name: string }[] = []
  for (const l of lines) {
    const item = items.find((i) => Number(i.item_id) === l.permitItemId)
    if (!item) return refuse(400, "bad_line", `Item ${l.permitItemId} is not on ${permitNo}.`, `الصنف ${l.permitItemId} ليس على ${permitNo}.`)
    const before = Number(item.quantity) || 0
    if (Math.abs(before - l.quantity) <= EPS) continue
    const name = item.item_name_snapshot || `item ${item.item_id}`
    if (!item.product_id) {
      return refuse(409, "OUTSOURCED", `"${name}" is an outsourced item: correct it with a return or a new delivery permit.`, `"${name}" صنف من مورد خارجي: صحّحه بمرتجع أو بإذن تسليم جديد.`)
    }
    changes.push({ item, before, after: l.quantity, name })
  }
  if (changes.length === 0) return refuse(400, "no_change", "Nothing to change: the quantities are the same.", "لا يوجد تغيير: الكميات كما هي.")

  // never below what was already returned (per item, as returns count it: by product / name)
  const returned = returnedByKey(await loadReturnLines(db, [permitId]), { permitId })
  const afterByKey = new Map<string, number>()
  for (const item of items) {
    const change = changes.find((c) => c.item === item)
    const key = lineKey(item.product_id, item.item_name_snapshot)
    afterByKey.set(key, (afterByKey.get(key) || 0) + (change ? change.after : Number(item.quantity) || 0))
  }
  for (const c of changes) {
    const key = lineKey(c.item.product_id, c.item.item_name_snapshot)
    const back = returned.get(key) || 0
    if ((afterByKey.get(key) || 0) + EPS < back) {
      return refuse(
        409,
        "BELOW_RETURNED",
        `"${c.name}": ${back} already returned on ${permitNo}, so the quantity can't go below ${back}.`,
        `"${c.name}": تم إرجاع ${back} على ${permitNo}، لذلك لا يمكن أن تقل الكمية عن ${back}.`,
      )
    }
  }

  // stock moves only when the permit's approval took stock (permits approved before stock deduction took none)
  const claim = must(
    await db.from("idempotency_log").select("status").eq("operation_type", DP_STOCK_OPERATION).eq("idempotency_key", dpStockKey(permitId)).limit(1).maybeSingle(),
    "load stock deduction",
  )
  const stockTaken = claim?.status === "completed"
  type Plan = { change: (typeof changes)[number]; row: any; quantity: number; direction: "out" | "back" }
  const plans: Plan[] = []
  if (stockTaken) {
    const events = must(
      await db.from("workflow_events").select("new_value").eq("entity_type", "DELIVERY_PERMIT").eq("entity_id", permitId).eq("event_type", "DP_STOCK_DEDUCTED"),
      "load the permit's stock moves",
    ) as any[]
    const deducted: StockMove[] = []
    for (const e of events) {
      try {
        deducted.push(...(JSON.parse(e.new_value || "[]") as StockMove[]))
      } catch {
        // unreadable entry: skipped
      }
    }
    const short: ShortLine[] = []
    for (const change of changes) {
      const productId = Number(change.item.product_id)
      let row: any = null
      if (change.item.warehouse_id) {
        row = (must(
          await db.from("inventory").select("inventory_id, product_id, warehouse_id, quantity").eq("product_id", productId).eq("warehouse_id", Number(change.item.warehouse_id)).eq("is_returned", false),
          "load inventory",
        ) as any[])[0]
      } else {
        const fromApproval = deducted.find((m) => !m.outsourced && Number(m.productId) === productId)
        const rows = must(
          await db.from("inventory").select("inventory_id, product_id, warehouse_id, quantity").eq("product_id", productId).eq("is_returned", false),
          "load inventory",
        ) as any[]
        row = fromApproval ? rows.find((r) => Number(r.inventory_id) === Number(fromApproval.inventoryId)) : rows.length === 1 ? rows[0] : null
        if (!row && rows.length > 1) {
          short.push({ productId, productName: change.name, warehouseId: null, requested: Math.abs(change.after - change.before), available: 0, reason: "WAREHOUSE_NOT_ALLOCATED" })
          continue
        }
      }
      if (!row) {
        short.push({ productId, productName: change.name, warehouseId: change.item.warehouse_id ?? null, requested: Math.abs(change.after - change.before), available: 0, reason: "NO_STOCK_ROW" })
        continue
      }
      const diff = change.after - change.before
      plans.push({ change, row, quantity: Math.abs(diff), direction: diff > 0 ? "out" : "back" })
    }
    // every extra quantity must be in stock before anything moves (as an approval checks)
    const need = new Map<number, { row: any; need: number; name: string; productId: number }>()
    for (const p of plans.filter((x) => x.direction === "out")) {
      const entry = need.get(p.row.inventory_id) || { row: p.row, need: 0, name: p.change.name, productId: Number(p.change.item.product_id) }
      entry.need += p.quantity
      need.set(p.row.inventory_id, entry)
    }
    for (const { row, need: n, name, productId } of need.values()) {
      if ((Number(row.quantity) || 0) + EPS < n) {
        short.push({ productId, productName: name, warehouseId: row.warehouse_id ?? null, requested: n, available: Number(row.quantity) || 0, reason: "INSUFFICIENT" })
      }
    }
    if (short.length > 0) return shortage(permitNo, short)
  }

  // ---- from here every step is undone on failure ----
  const moves: CorrectionMove[] = []
  const restored: { itemId: number; quantity: number; total: any; expected: number }[] = []
  const undo = async (reason: string): Promise<ReissueRefusal> => {
    const linesNotRestored: number[] = []
    for (const r of restored) {
      const res = await db.from("delivery_permit_items").update({ quantity: r.quantity, total: r.total }).eq("item_id", r.itemId).eq("quantity", r.expected).select("item_id")
      if (res.error || !res.data || res.data.length !== 1) {
        console.error(`[reissue] could not restore permit item ${r.itemId} to ${r.quantity}`)
        linesNotRestored.push(r.itemId)
      }
    }
    const failed = await undoCorrectionMoves(db, moves)
    if (failed.length > 0 || linesNotRestored.length > 0) {
      console.error(`[reissue] correction of ${permitNo}: could not be fully undone`, { stock: failed, permitItems: linesNotRestored })
      const what = [failed.length > 0 ? "the stock" : "", linesNotRestored.length > 0 ? "the permit quantities" : ""].filter(Boolean).join(" and ")
      const whatAr = [failed.length > 0 ? "المخزون" : "", linesNotRestored.length > 0 ? "كميات الإذن" : ""].filter(Boolean).join(" و")
      return refuse(
        500,
        "partial_failure",
        `The correction of ${permitNo} failed and ${what} could not be fully put back; contact an administrator.`,
        `فشل تصحيح ${permitNo} وتعذّر إرجاع ${whatAr} بالكامل؛ تواصل مع المسؤول.`,
      )
    }
    return refuse(409, "changed", reason, "تغيّر الإذن أو المخزون أثناء التصحيح. لم يتغير شيء؛ حاول مرة أخرى.")
  }

  try {
    for (const p of [...plans.filter((x) => x.direction === "out"), ...plans.filter((x) => x.direction === "back")]) {
      const base = { inventoryId: Number(p.row.inventory_id), productId: Number(p.change.item.product_id), warehouseId: p.row.warehouse_id ?? null, quantity: p.quantity, productName: p.change.name }
      if (p.direction === "out") {
        const taken = await takeFromRow(db, base.inventoryId, p.quantity)
        if (!taken.ok) {
          const reverted = await undo("The stock changed while the permit was corrected. Nothing was changed; try again.")
          return reverted.code === "partial_failure"
            ? reverted
            : shortage(permitNo, [{ productId: base.productId, productName: base.productName, warehouseId: base.warehouseId, requested: p.quantity, available: taken.available, reason: "INSUFFICIENT" }])
        }
        moves.push({ ...base, before: taken.before, after: taken.after, direction: "out" })
      } else {
        const added = await addToRow(db, base.inventoryId, p.quantity)
        if (!added.ok) return await undo("The stock changed while the permit was corrected. Nothing was changed; try again.")
        moves.push({ ...base, before: added.before, after: added.after, direction: "back" })
      }
    }

    for (const c of changes) {
      const unit = c.item.unit_price == null || c.item.unit_price === "" ? null : Number(c.item.unit_price)
      // the line keeps its value per unit (the invoice prices a permit line from its stored total)
      const total =
        c.item.total != null && c.before > 0
          ? round2((Number(c.item.total) * c.after) / c.before)
          : unit !== null && Number.isFinite(unit)
            ? round2(unit * c.after)
            : c.item.total ?? null
      const res = await db
        .from("delivery_permit_items")
        .update({ quantity: c.after, total })
        .eq("item_id", c.item.item_id)
        .eq("quantity", c.item.quantity)
        .select("item_id")
      if (res.error || !res.data || res.data.length !== 1) return await undo(`${permitNo} was changed by someone else at the same time. Nothing was changed; try again.`)
      restored.push({ itemId: c.item.item_id, quantity: c.item.quantity, total: c.item.total ?? null, expected: c.after })
    }

    // the new invoice may have been made meanwhile: then the permit is locked again
    if (!(await openCorrectionForPermit(db, permitId))) return await undo(CORRECT_NOT_OPEN.message(permitNo))

    const recordLines = changes.map((c) => ({ permitItemId: Number(c.item.item_id), productId: c.item.product_id ?? null, name: c.name, before: c.before, after: c.after }))
    const { data: saved, error: saveError } = await db
      .from("dp_corrections")
      .insert({ permit_id: permitId, invoice_id: correction.invoiceId, lines: recordLines, stock_moves: moves, created_by: userId })
      .select("correction_id")
    if (saveError) return await undo(`The correction could not be recorded (${saveError.message}). Nothing was changed.`)
    const correctionId = (Array.isArray(saved) ? saved[0]?.correction_id : saved?.correction_id) ?? null

    // derived records: never undo the correction
    if (moves.length > 0) await auditMoves(db, moves, permitId, permit.permit_no ?? null, oldNumber, userId)
    await logEvent(db, permitId, "DP_CORRECTED", `Correction for invoice ${oldNumber}`, userId, "DELIVERY_PERMIT", { lines: recordLines, stockMoves: moves })
    if (permit.sales_order_id) {
      try {
        await reopenIfNotFullyDelivered(db, Number(permit.sales_order_id))
        await markDeliveredIfComplete(db, Number(permit.sales_order_id))
      } catch (e: any) {
        console.error("[reissue] could not refresh the order's delivery status after the correction:", e?.message || e)
      }
    }
    return { ok: true, correctionId, lines: recordLines.map(({ permitItemId, name, before, after }) => ({ permitItemId, name, before, after })), stockMoves: moves }
  } catch (error: any) {
    console.error(`[reissue] correction of ${permitNo} failed:`, error?.message || error)
    return await undo("The delivery permit could not be corrected. Nothing was changed.")
  }
}

async function auditMoves(db: Db, moves: CorrectionMove[], permitId: number, permitNo: string | null, oldNumber: string, userId: number | null) {
  try {
    const { error: auditError } = await db.from("inventory_transactions").insert(
      moves.map((m) => ({
        product_id: m.productId,
        transaction_type: m.direction === "out" ? "sale" : "return",
        reference_type: "DELIVERY_PERMIT",
        reference_id: permitId,
        reference_number: permitNo,
        quantity_change: m.direction === "out" ? -m.quantity : m.quantity,
        quantity_before: m.before,
        quantity_after: m.after,
        notes: `Correction for invoice ${oldNumber}${m.warehouseId ? ` - warehouse ${m.warehouseId}` : ""}${userId ? ` - by user ${userId}` : ""}`,
        created_by: null,
      })),
    )
    if (auditError) console.error("[reissue] stock audit insert failed (the correction stands):", auditError.message)
  } catch (e: any) {
    console.error("[reissue] stock audit insert failed (the correction stands):", e?.message || e)
  }
}

function shortage(permitNo: string, lines: ShortLine[]): ReissueRefusal & { lines: ShortLine[] } {
  const list = lines
    .map((l) =>
      l.reason === "WAREHOUSE_NOT_ALLOCATED"
        ? `${l.productName}: no warehouse is set on the permit and several warehouses hold it`
        : l.reason === "NO_STOCK_ROW"
          ? `${l.productName}: no stock record${l.warehouseId ? ` in warehouse ${l.warehouseId}` : ""}`
          : `${l.productName}: needs ${l.requested}, in stock ${l.available}${l.warehouseId ? ` (warehouse ${l.warehouseId})` : ""}`,
    )
    .join("; ")
  return {
    ...refuse(409, "INSUFFICIENT_STOCK", `Cannot correct ${permitNo}: ${list}. Nothing was changed.`, `تعذّر تصحيح ${permitNo}: المخزون غير كافٍ (${list}). لم يتغير شيء.`),
    lines,
  }
}
