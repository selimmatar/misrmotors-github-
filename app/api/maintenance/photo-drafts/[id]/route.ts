import { NextResponse, after } from "next/server"
import { get } from "@vercel/blob"
import { createAdminClient } from "@/lib/supabase/admin"
import { actorUserId } from "@/lib/auth/actor"
import { createQuickMaintenanceInvoice, validateQuickInvoice } from "@/lib/maintenance-quick-invoice"
import { MAX_REJECT_REASON, readDraftPhoto } from "@/lib/maintenance-photos"

// One photo draft: create the MINV invoice from it, reject it, or read the photo again (spec 2026-11-19, Part 2).
// Creating goes through the same createQuickMaintenanceInvoice as the quick maintenance screen. The draft is claimed
// (waiting -> converting) in one database step first, so two clicks can never make two invoices.
export const dynamic = "force-dynamic"
export const maxDuration = 60

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
    return NextResponse.json({ ok: true })
  }

  if (action === "reread") {
    const { data: row } = await db.from("maintenance_photo_drafts").select("photo_path, photo_type, status").eq("id", id).maybeSingle()
    if (!row) return answer(404, "Photo not found")
    if (row.status !== "waiting") return answer(409, "This photo was already handled")
    const file = await get(row.photo_path, { access: "private" })
    if (!file || file.statusCode !== 200 || !file.stream) return answer(404, "Photo not found")
    const base64 = Buffer.from(await new Response(file.stream).arrayBuffer()).toString("base64")
    await db.from("maintenance_photo_drafts").update({ read_status: "reading" }).eq("id", id)
    after(() => readDraftPhoto(db, id, base64, row.photo_type))
    return NextResponse.json({ ok: true })
  }

  if (action !== "create") return answer(400, "Unknown action")
  const checked = validateQuickInvoice({ customerId: body?.customerId, lines: body?.lines })
  if (!checked.ok) return answer(400, checked.error)

  const { data: claimed, error: claimError } = await db
    .from("maintenance_photo_drafts")
    .update({ status: "converting" })
    .eq("id", id)
    .eq("status", "waiting")
    .select("id")
  if (claimError) return answer(500, "Could not start the invoice")
  if (!claimed?.length) return answer(409, "This photo was already handled")

  const result = await createQuickMaintenanceInvoice(db, checked.value)
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
