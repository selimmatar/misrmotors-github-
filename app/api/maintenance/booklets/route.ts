import { NextResponse } from "next/server"
import { createAdminClient } from "@/lib/supabase/admin"
import { actorUserId } from "@/lib/auth/actor"
import { cleanMinvNumber } from "@/lib/invoice-codes"
import { MAX_VOID_REASON, bookletStats, createBooklet, minvNumber, type BookletRow } from "@/lib/maintenance-booklets"

// Pre-numbered carbon booklets (spec 2026-11-19, Part 3). GET: the accountant; POST / PATCH: admin and CEO.
export const dynamic = "force-dynamic"

const answer = (status: number, error: string) => NextResponse.json({ error }, { status })

export async function GET() {
  const db = createAdminClient()
  const { data, error } = await db
    .from("maintenance_booklets")
    .select("id, link_id, year2, first_serial, last_serial, status, created_at, link:maintenance_upload_links(worker_name)")
    .order("created_at", { ascending: false })
    .limit(100)
  if (error) return answer(500, "Could not load the booklets")
  const booklets = (data || []) as unknown as Array<BookletRow & { link: { worker_name: string } | null }>

  const years = [...new Set(booklets.map((b) => b.year2))]
  const used = new Set<string>()
  for (const year2 of years) {
    const { data: rows, error: numbersError } = await db.from("accounts_receivable").select("invoice_number").like("invoice_number", `MINV${year2}%`)
    if (numbersError) return answer(500, "Could not load the booklets")
    for (const r of rows || []) used.add(String(r.invoice_number))
  }
  const voided = new Set<string>()
  if (booklets.length) {
    const { data: rows, error: voidError } = await db.from("maintenance_booklet_voids").select("invoice_number").in("booklet_id", booklets.map((b) => b.id))
    if (voidError) return answer(500, "Could not load the booklets")
    for (const r of rows || []) voided.add(String(r.invoice_number))
  }

  return NextResponse.json({
    booklets: booklets.map((b) => ({
      id: b.id,
      linkId: b.link_id,
      workerName: b.link?.worker_name || "",
      firstNumber: minvNumber(b.year2, b.first_serial),
      lastNumber: minvNumber(b.year2, b.last_serial),
      status: b.status,
      createdAt: b.created_at,
      ...bookletStats(b, used, voided),
    })),
  })
}

/** { linkId } gives that worker a new booklet of the next 300 MINV numbers. */
export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as Record<string, any> | null
  const linkId = Number(body?.linkId)
  if (!Number.isInteger(linkId) || linkId <= 0) return answer(400, "Choose the worker")
  const db = createAdminClient()
  const { data: link } = await db.from("maintenance_upload_links").select("id, active").eq("id", linkId).maybeSingle()
  if (!link) return answer(404, "Worker link not found")
  if (!link.active) return answer(400, "This worker's link is switched off")
  try {
    const booklet = await createBooklet(db, linkId, actorUserId(request))
    return NextResponse.json({
      id: booklet.id,
      firstNumber: minvNumber(booklet.year2, booklet.first_serial),
      lastNumber: minvNumber(booklet.year2, booklet.last_serial),
    })
  } catch (error: any) {
    console.error("[booklets] create:", error?.message || error)
    return answer(500, "Could not make the booklet")
  }
}

/** { id, status } marks a booklet finished / active; { id, action: "void", invoiceNumber, reason } cancels a lost page. */
export async function PATCH(request: Request) {
  const body = (await request.json().catch(() => null)) as Record<string, any> | null
  const id = Number(body?.id)
  if (!Number.isInteger(id) || id <= 0) return answer(400, "Missing booklet")
  const db = createAdminClient()

  if (body?.action === "void") {
    const number = cleanMinvNumber(body?.invoiceNumber)
    const { data: booklet } = await db.from("maintenance_booklets").select("year2, first_serial, last_serial").eq("id", id).maybeSingle()
    if (!booklet) return answer(404, "Booklet not found")
    const serial = Number(number.slice(6))
    if (!number || number.slice(4, 6) !== booklet.year2 || serial < booklet.first_serial || serial > booklet.last_serial) {
      return answer(400, "That number is not in this booklet")
    }
    const { data: used } = await db.from("accounts_receivable").select("invoice_id").eq("invoice_number", number).limit(1)
    if (used?.length) return answer(400, `${number} is already on an invoice`)
    const reason = String(body?.reason ?? "").trim().slice(0, MAX_VOID_REASON) || "Lost page"
    const { error } = await db.from("maintenance_booklet_voids").insert({ booklet_id: id, invoice_number: number, reason, created_by: actorUserId(request) })
    if (error) return answer(error.code === "23505" ? 409 : 500, error.code === "23505" ? `Page ${number} was already cancelled` : "Could not cancel the page")
    return NextResponse.json({ ok: true })
  }

  if (body?.status !== "active" && body?.status !== "finished") return answer(400, "Missing details")
  const { data, error } = await db.from("maintenance_booklets").update({ status: body.status }).eq("id", id).select("id")
  if (error) return answer(500, "Could not change the booklet")
  if (!data?.length) return answer(404, "Booklet not found")
  return NextResponse.json({ ok: true })
}
