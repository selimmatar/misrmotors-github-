import { createAdminClient } from "@/lib/supabase/admin"
import { NextResponse } from "next/server"
import { actorUserId } from "@/lib/auth/actor"
import { knownUserId } from "@/lib/po-history"
import { normalizeName } from "@/lib/eta/normalize"
import { rememberCode } from "@/lib/eta/store"

export const dynamic = "force-dynamic"

export async function GET(request: Request) {
  try {
    const db = createAdminClient()
    const q = normalizeName(new URL(request.url).searchParams.get("q") || "")
    let query = db.from("eta_code_memory").select("*").order("confirmed_at", { ascending: false })
    if (q) query = query.ilike("normalized_name", `%${q}%`)
    const { data, error } = await query.limit(500)
    if (error) throw error
    return NextResponse.json(data || [])
  } catch (error: any) {
    console.error("Error listing code memory:", error)
    return NextResponse.json({ error: "Failed to list code memory" }, { status: 500 })
  }
}

export async function POST(request: Request) {
  try {
    const db = createAdminClient()
    const body = await request.json().catch(() => null)
    if (!body || typeof body !== "object") return NextResponse.json({ error: "Invalid body" }, { status: 400 })
    const userId = await knownUserId(db, actorUserId(request))
    try {
      await rememberCode(db, { name: body.name, codeId: Number(body.codeId), unitType: body.unitType, userId, source: "confirmed" })
    } catch (e: any) {
      return NextResponse.json({ error: e.message || "Could not save" }, { status: 400 })
    }
    return NextResponse.json({ success: true })
  } catch (error: any) {
    console.error("Error confirming code:", error)
    return NextResponse.json({ error: error.message || "Failed to save" }, { status: 500 })
  }
}

export async function DELETE(request: Request) {
  try {
    const db = createAdminClient()
    const id = Number(new URL(request.url).searchParams.get("id"))
    if (!Number.isInteger(id) || id < 1) return NextResponse.json({ error: "id is required" }, { status: 400 })
    const { error } = await db.from("eta_code_memory").delete().eq("memory_id", id)
    if (error) throw error
    return NextResponse.json({ success: true })
  } catch (error: any) {
    console.error("Error removing code memory:", error)
    return NextResponse.json({ error: error.message || "Failed to remove" }, { status: 500 })
  }
}
