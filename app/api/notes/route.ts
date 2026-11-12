// Notes / latest updates on a sales order, quotation or purchase order (owner request, 2026-11-12).
// Kept in the history log (workflow_events, event_type NOTE): no new table. Anyone can add, edit or delete a note.
//   GET    ?type=so|quotation|po&id=N   -> the notes, newest first
//   GET    ?type=so|quotation|po&counts=1 -> { counts: { [id]: n } } for the badges on a list
//   POST   { type, id, text, userId? }   -> add
//   PUT    { noteId, text }              -> edit
//   DELETE ?noteId=N                     -> delete
import { NextResponse } from "next/server"
import { createAdminClient } from "@/lib/supabase/admin"
import { parsePositiveId } from "@/lib/parse-id"
import { knownUserId } from "@/lib/po-history"

export const dynamic = "force-dynamic"

const ENTITY: Record<string, string> = { so: "SALES_ORDER", quotation: "SALES_QUOTATION", po: "PURCHASE_ORDER" }
const MAX = 4000
const refuse = (status: number, error: string) => NextResponse.json({ error }, { status })
const shape = (e: any) => ({ id: e.event_id, text: e.notes || "", at: e.performed_at, editedAt: e.metadata?.edited_at || null })

export async function GET(request: Request) {
  try {
    const params = new URL(request.url).searchParams
    const entity = ENTITY[String(params.get("type"))]
    if (!entity) return refuse(400, "type must be so, quotation or po")
    const db = createAdminClient()
    if (params.get("counts")) {
      const { data, error } = await db.from("workflow_events").select("entity_id").eq("entity_type", entity).eq("event_type", "NOTE")
      if (error) throw error
      const counts: Record<string, number> = {}
      for (const e of data || []) counts[e.entity_id] = (counts[e.entity_id] || 0) + 1
      return NextResponse.json({ counts })
    }
    const id = parsePositiveId(params.get("id"))
    if (id === null) return refuse(400, "id is required")
    const { data, error } = await db
      .from("workflow_events")
      .select("event_id, notes, performed_at, metadata")
      .eq("entity_type", entity)
      .eq("entity_id", id)
      .eq("event_type", "NOTE")
    if (error) throw error
    const notes = (data || []).map(shape).sort((a: any, b: any) => String(b.at || "").localeCompare(String(a.at || "")) || b.id - a.id)
    return NextResponse.json({ notes })
  } catch (error) {
    console.error("Notes GET failed", error)
    return refuse(500, "Could not load the notes")
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => null)
    const entity = ENTITY[String(body?.type)]
    const id = parsePositiveId(body?.id)
    const text = String(body?.text ?? "").trim()
    if (!entity || id === null) return refuse(400, "Choose the document")
    if (!text) return refuse(400, "Write the note first")
    if (text.length > MAX) return refuse(400, `A note can be at most ${MAX} characters`)
    const db = createAdminClient()
    const { data, error } = await db
      .from("workflow_events")
      .insert({ entity_type: entity, entity_id: id, event_type: "NOTE", notes: text, performed_by: await knownUserId(db, body?.userId), metadata: {} })
      .select("event_id, notes, performed_at, metadata")
      .single()
    if (error) throw error
    return NextResponse.json({ note: shape(data) })
  } catch (error) {
    console.error("Notes POST failed", error)
    return refuse(500, "The note could not be saved")
  }
}

export async function PUT(request: Request) {
  try {
    const body = await request.json().catch(() => null)
    const noteId = parsePositiveId(body?.noteId)
    const text = String(body?.text ?? "").trim()
    if (noteId === null) return refuse(400, "Choose the note")
    if (!text) return refuse(400, "A note cannot be empty; delete it instead")
    if (text.length > MAX) return refuse(400, `A note can be at most ${MAX} characters`)
    const db = createAdminClient()
    const { data, error } = await db
      .from("workflow_events")
      .update({ notes: text, metadata: { edited_at: new Date().toISOString() } })
      .eq("event_id", noteId)
      .eq("event_type", "NOTE")
      .select("event_id, notes, performed_at, metadata")
    if (error) throw error
    if (!data || data.length === 0) return refuse(404, "Note not found")
    return NextResponse.json({ note: shape(data[0]) })
  } catch (error) {
    console.error("Notes PUT failed", error)
    return refuse(500, "The note could not be saved")
  }
}

export async function DELETE(request: Request) {
  try {
    const noteId = parsePositiveId(new URL(request.url).searchParams.get("noteId"))
    if (noteId === null) return refuse(400, "Choose the note")
    const db = createAdminClient()
    const { data, error } = await db.from("workflow_events").delete().eq("event_id", noteId).eq("event_type", "NOTE").select("event_id")
    if (error) throw error
    if (!data || data.length === 0) return refuse(404, "Note not found")
    return NextResponse.json({ ok: true })
  } catch (error) {
    console.error("Notes DELETE failed", error)
    return refuse(500, "The note could not be deleted")
  }
}
