// POST { proposal } -> saves one card the CEO chat proposed, after the person pressed Confirm (owner request,
// 2026-11-14). Nothing is written by the AI itself: this route re-checks the card and then calls the SAME route the
// screens use (notes, new purchase order, new quotation), with the person's own login, so every check, number and
// history entry is the normal one. A note "Created from the CEO chat" marks the new PO / quotation.
// CEO and admins only (/api/ai in lib/auth/permissions.ts).
import { NextResponse } from "next/server"
import { createAdminClient } from "@/lib/supabase/admin"
import { actorUserId } from "@/lib/auth/actor"
import { knownUserId } from "@/lib/po-history"
import * as notesRoute from "@/app/api/notes/route"
import * as purchaseOrdersRoute from "@/app/api/purchase-orders/route"
import * as quotationsRoute from "@/app/api/sales-quotations/route"

export const dynamic = "force-dynamic"

const refuse = (error: string, status = 400) => NextResponse.json({ ok: false, error }, { status })
const pos = (v: unknown) => Number.isInteger(Number(v)) && Number(v) > 0
const amount = (v: unknown) => Number.isFinite(Number(v)) && Number(v) >= 0
const text = (v: unknown, max: number) => typeof v === "string" && v.trim().length > 0 && v.length <= max

/** The same request the screen would send, with the person's login (cookie and identity headers) passed on. */
function sameUser(request: Request, path: string, body: unknown): Request {
  const headers = new Headers({ "content-type": "application/json" })
  for (const [k, v] of request.headers) if (k === "cookie" || k.startsWith("x-mm-")) headers.set(k, v)
  return new Request(new URL(path, request.url), { method: "POST", headers, body: JSON.stringify(body) })
}
async function answer(res: Response) {
  const body = await res.json().catch(() => ({}))
  return { ok: res.ok, status: res.status, body }
}
async function markFromChat(db: any, entity: string, id: number, userId: number | null) {
  const { error } = await db
    .from("workflow_events")
    .insert({ entity_type: entity, entity_id: id, event_type: "NOTE", notes: "Created from the CEO chat", performed_by: userId, metadata: { source: "ceo-chat" } })
  if (error) console.error("CEO chat confirm: could not add the note", error)
}

export async function POST(request: Request) {
  let p: any
  try {
    p = (await request.json())?.proposal
  } catch {
    return refuse("Invalid JSON body")
  }
  if (!p || typeof p !== "object") return refuse("Nothing to confirm")
  const db = createAdminClient()
  const userId = await knownUserId(db, actorUserId(request))

  try {
    if (p.kind === "note") {
      if (!["so", "po", "quotation"].includes(p.target) || !pos(p.id) || !text(p.text, 4000)) return refuse("This note card is not valid")
      const r = await answer(await notesRoute.POST(sameUser(request, "/api/notes", { type: p.target, id: Number(p.id), text: p.text, userId })))
      if (!r.ok) return refuse(r.body?.error || "Could not save the note", r.status)
      return NextResponse.json({ ok: true, message: `Note added to ${p.number}` })
    }

    if (p.kind === "purchase_order") {
      const lines = Array.isArray(p.lines) ? p.lines : []
      if (!pos(p.supplierId) || lines.length === 0 || lines.length > 50) return refuse("This purchase order card is not valid")
      for (const l of lines) {
        if (!text(l?.name, 300) || !(Number(l?.quantity) > 0) || !amount(l?.unitCost)) return refuse("A line on this card is not valid")
        if ((l.sourceSoItemId != null && !pos(l.sourceSoItemId)) || (l.sourceSoId != null && !pos(l.sourceSoId))) return refuse("A line on this card is not valid")
      }
      const body = {
        supplier_id: Number(p.supplierId),
        order_date: new Date().toISOString().slice(0, 10),
        status: "pending",
        currency: "EGP",
        tax_amount: 0,
        payment_type: "cash",
        payment_terms: "prepaid",
        created_by: userId,
        // every line keeps its name; a line for a sales order is linked to that order's line
        items: lines.map((l: any) => ({
          itemType: "outsourced",
          productName: l.name,
          outsourcedName: l.name,
          quantity: Number(l.quantity),
          unitPrice: Number(l.unitCost),
          sourceSoId: l.sourceSoItemId ? String(l.sourceSoId) : null,
          sourceSoItemId: l.sourceSoItemId ? String(l.sourceSoItemId) : null,
        })),
      }
      const r = await answer(await purchaseOrdersRoute.POST(sameUser(request, "/api/purchase-orders", body)))
      if (!r.ok) return refuse(r.body?.error || "Could not create the purchase order", r.status)
      const po = r.body?.purchaseOrder || r.body?.order || r.body
      const poId = Number(po?.po_id ?? po?.id)
      if (pos(poId)) await markFromChat(db, "PURCHASE_ORDER", poId, userId)
      return NextResponse.json({ ok: true, message: `Purchase order ${po?.po_number || po?.poNumber || ""} created (pending approval)`.replace("  ", " ") })
    }

    if (p.kind === "quotation") {
      const lines = Array.isArray(p.lines) ? p.lines : []
      if (!text(p.customer, 200) || lines.length === 0 || lines.length > 50 || (p.customerId != null && !pos(p.customerId))) return refuse("This quotation card is not valid")
      for (const l of lines) {
        if (!text(l?.name, 300) || !(Number(l?.quantity) > 0) || !amount(l?.unitPrice) || (l.productId != null && !pos(l.productId))) return refuse("A line on this card is not valid")
      }
      const body = {
        customer_id: p.customerId ?? null,
        customer_name: p.customer,
        validity_days: 30,
        notes: typeof p.notes === "string" ? p.notes.slice(0, 2000) : "",
        items: lines.map((l: any) => ({
          item_type: l.productId ? "inventory" : "outsourced",
          product_id: l.productId ?? null,
          product_name: l.name,
          quantity: Number(l.quantity),
          unit_price: Number(l.unitPrice),
        })),
      }
      const r = await answer(await quotationsRoute.POST(sameUser(request, "/api/sales-quotations", body) as any))
      if (!r.ok) return refuse(r.body?.error || "Could not create the quotation", r.status)
      const q = r.body?.quotation
      if (pos(q?.id)) await markFromChat(db, "SALES_QUOTATION", Number(q.id), userId)
      return NextResponse.json({ ok: true, message: `Quotation ${q?.quotation_number || ""} created`.trim() })
    }

    return refuse("Unknown card")
  } catch (error) {
    console.error("CEO chat confirm error:", error)
    return refuse("Could not save. Please try again.", 500)
  }
}
