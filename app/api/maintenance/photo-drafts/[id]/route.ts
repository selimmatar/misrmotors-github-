import { NextResponse, after } from "next/server"
import { get } from "@vercel/blob"
import { createAdminClient } from "@/lib/supabase/admin"
import { actorUserId } from "@/lib/auth/actor"
import { createQuickMaintenanceInvoice, validateQuickInvoice } from "@/lib/maintenance-quick-invoice"
import { MAX_REJECT_REASON, readDraftPhoto } from "@/lib/maintenance-photos"
import { MAX_VOID_REASON, checkBookletPage, hasActiveBooklet } from "@/lib/maintenance-booklets"
import { cleanMinvNumber } from "@/lib/invoice-codes"
import { isSharedNumber, releaseSlot } from "@/lib/shared-invoice-numbers"

// One photo draft: create the MINV invoice from it, reject it, or read the photo again (spec 2026-11-19, Part 2).
// Creating goes through the same createQuickMaintenanceInvoice as the quick maintenance screen. The draft is claimed
// (waiting -> converting) in one database step first, so two clicks can never make two invoices.
export const dynamic = "force-dynamic"
export const maxDuration = 120

const answer = (status: number, error: string) => NextResponse.json({ error }, { status })

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const id = Number((await params).id)
  if (!Number.isInteger(id) || id <= 0) return answer(404, "Photo not found")
  const body = (await request.json().catch(() => null)) as Record<string, any> | null
  const action = body?.action
  const db = createAdminClient()
  const reviewer = actorUserId(request)

  if (action === "reject") {
    const reason = String(body?.reason ?? "").trim().slice(0, MAX_REJECT_REASON) || null
    const { data, error } = await db
      .from("maintenance_photo_drafts")
      .update({ status: "rejected", reject_reason: reason, reviewed_by: reviewer, reviewed_at: new Date().toISOString() })
      .eq("id", id)
      .eq("status", "waiting")
      .select("id")
    if (error) return answer(500, "Could not reject the photo")
    if (!data?.length) return answer(409, "This photo was already handled")
    // The paper page still carries its number: it stays the worker's, so he can send a better photo of it.
    await db.from("invoice_number_slots").update({ draft_id: null, updated_at: new Date().toISOString() }).eq("draft_id", id).eq("status", "reserved")
    return NextResponse.json({ ok: true })
  }

  if (action === "reread") {
    const { data: row } = await db.from("maintenance_photo_drafts").select("photo_path, photo_type, status").eq("id", id).maybeSingle()
    if (!row) return answer(404, "Photo not found")
    if (row.status !== "waiting") return answer(409, "This photo was already handled")
    const file = await get(row.photo_path, { access: "public" })
    if (!file || file.statusCode !== 200 || !file.stream) return answer(404, "Photo not found")
    const base64 = Buffer.from(await new Response(file.stream).arrayBuffer()).toString("base64")
    await db.from("maintenance_photo_drafts").update({ read_status: "reading" }).eq("id", id)
    after(() => readDraftPhoto(db, id, base64, row.photo_type))
    return NextResponse.json({ ok: true })
  }

  if (action === "void") {
    // A spoiled booklet page: the draft is closed and its printed number recorded, so it is never used.
    const { data: row } = await db.from("maintenance_photo_drafts").select("link_id, status, invoice_number").eq("id", id).maybeSingle()
    if (!row) return answer(404, "Photo not found")
    if (row.status !== "waiting") return answer(409, "This photo was already handled")
    if (isSharedNumber(row.invoice_number)) {
      // Shared numbering: the spoiled page's number goes to the next sales invoice when the portal order allows.
      const reason = String(body?.reason ?? "").trim().slice(0, MAX_VOID_REASON) || "Cancelled page"
      const { data: closed } = await db
        .from("maintenance_photo_drafts")
        .update({ status: "rejected", reject_reason: `${reason} (${row.invoice_number})`, reviewed_by: reviewer, reviewed_at: new Date().toISOString() })
        .eq("id", id)
        .eq("status", "waiting")
        .select("id")
      if (!closed?.length) return answer(409, "This photo was already handled")
      await releaseSlot(db, Number(row.invoice_number), "spoiled")
      return NextResponse.json({ ok: true, invoiceNumber: row.invoice_number })
    }
    const number = cleanMinvNumber(body?.invoiceNumber)
    const page = await checkBookletPage(db, Number(row.link_id), number)
    if (!page.ok) return answer(400, page.error)
    const reason = String(body?.reason ?? "").trim().slice(0, MAX_VOID_REASON) || "Cancelled page"
    const { data: closed, error: closeError } = await db
      .from("maintenance_photo_drafts")
      .update({ status: "rejected", reject_reason: `${reason} (${number})`, reviewed_by: reviewer, reviewed_at: new Date().toISOString() })
      .eq("id", id)
      .eq("status", "waiting")
      .select("id")
    if (closeError) return answer(500, "Could not cancel the page")
    if (!closed?.length) return answer(409, "This photo was already handled")
    const { error: voidError } = await db
      .from("maintenance_booklet_voids")
      .insert({ booklet_id: page.bookletId, invoice_number: number, reason, draft_id: id, created_by: reviewer })
    if (voidError) {
      await db.from("maintenance_photo_drafts").update({ status: "waiting", reject_reason: null, reviewed_by: null, reviewed_at: null }).eq("id", id)
      return answer(voidError.code === "23505" ? 409 : 500, voidError.code === "23505" ? `Page ${number} was already cancelled` : "Could not cancel the page")
    }
    return NextResponse.json({ ok: true, invoiceNumber: number })
  }

  if (action !== "create") return answer(400, "Unknown action")
  const checked = validateQuickInvoice({ customerId: body?.customerId, lines: body?.lines })
  if (!checked.ok) return answer(400, checked.error)

  // A worker with a booklet: the invoice takes exactly the number printed on his page (Part 3).
  const { data: draftRow } = await db.from("maintenance_photo_drafts").select("link_id, invoice_number").eq("id", id).maybeSingle()
  if (!draftRow) return answer(404, "Photo not found")
  const typed = cleanMinvNumber(body?.invoiceNumber)
  let invoiceNumber: string | null = null
  if (isSharedNumber(draftRow.invoice_number)) {
    // Shared numbering: the number the worker reserved before writing the page.
    invoiceNumber = String(draftRow.invoice_number)
  } else if (typed || (await hasActiveBooklet(db))) {
    if (!typed) return answer(400, "Enter the MINV number printed on the page")
    const page = await checkBookletPage(db, Number(draftRow.link_id), typed)
    if (!page.ok) return answer(400, page.error)
    invoiceNumber = page.number
  }

  const { data: claimed, error: claimError } = await db
    .from("maintenance_photo_drafts")
    .update({ status: "converting" })
    .eq("id", id)
    .eq("status", "waiting")
    .select("id")
  if (claimError) return answer(500, "Could not start the invoice")
  if (!claimed?.length) return answer(409, "This photo was already handled")

  const result = await createQuickMaintenanceInvoice(db, { ...checked.value, invoiceNumber })
  if (result.status !== 200) {
    await db.from("maintenance_photo_drafts").update({ status: "waiting" }).eq("id", id)
    return NextResponse.json(result.body, { status: result.status })
  }
  const { error: doneError } = await db
    .from("maintenance_photo_drafts")
    .update({
      status: "converted",
      customer_id: checked.value.customerId,
      invoice_id: result.body.invoiceId,
      invoice_number: result.body.invoiceNumber,
      reviewed_by: reviewer,
      reviewed_at: new Date().toISOString(),
    })
    .eq("id", id)
  if (doneError) console.error(`[photo-drafts] invoice ${result.body.invoiceNumber} made, draft ${id} not marked:`, doneError.message)
  return NextResponse.json(result.body)
}
