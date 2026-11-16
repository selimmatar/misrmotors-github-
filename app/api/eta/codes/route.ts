import { createAdminClient } from "@/lib/supabase/admin"
import { NextResponse } from "next/server"
import { actorUserId } from "@/lib/auth/actor"
import { knownUserId } from "@/lib/po-history"
import { normalizeName } from "@/lib/eta/normalize"

export const dynamic = "force-dynamic"

function keywordsOf(raw: unknown): string[] {
  const list = Array.isArray(raw) ? raw : typeof raw === "string" ? raw.split(/[,،\n]/) : []
  return [...new Set(list.map((k) => normalizeName(String(k))).filter(Boolean))]
}

function fieldsOf(body: any, partial: boolean): { fields: Record<string, any> } | { error: string } {
  const f: Record<string, any> = {}
  if (!partial || "item_code" in body) {
    const v = String(body.item_code ?? "").trim()
    if (!v) return { error: "item_code is required" }
    f.item_code = v
  }
  if (!partial || "code_type" in body) {
    const v = String(body.code_type ?? "EGS").trim().toUpperCase()
    if (v !== "EGS" && v !== "GS1") return { error: "code_type must be EGS or GS1" }
    f.code_type = v
  }
  if (!partial || "name" in body) {
    const v = String(body.name ?? "").trim()
    if (!v) return { error: "name is required" }
    f.name = v
  }
  if (!partial || "keywords" in body) f.keywords = keywordsOf(body.keywords)
  if (!partial || "default_unit" in body) f.default_unit = String(body.default_unit ?? "").trim() || "EA"
  if ("active" in body) f.active = body.active !== false
  return { fields: f }
}

const duplicate = (error: any) => error?.code === "23505" || /duplicate key/i.test(String(error?.message || ""))

export async function GET(_request: Request) {
  try {
    const db = createAdminClient()
    const { data, error } = await db.from("eta_item_codes").select("*").order("code_id", { ascending: true })
    if (error) throw error
    return NextResponse.json(data || [])
  } catch (error: any) {
    console.error("Error listing item codes:", error)
    return NextResponse.json({ error: "Failed to list item codes" }, { status: 500 })
  }
}

export async function POST(request: Request) {
  try {
    const db = createAdminClient()
    const body = await request.json().catch(() => null)
    if (!body || typeof body !== "object") return NextResponse.json({ error: "Invalid body" }, { status: 400 })
    const r = fieldsOf(body, false)
    if ("error" in r) return NextResponse.json({ error: r.error }, { status: 400 })
    const created_by = await knownUserId(db, actorUserId(request))
    const { data, error } = await db.from("eta_item_codes").insert({ active: true, ...r.fields, created_by }).select().single()
    if (error) {
      if (duplicate(error)) return NextResponse.json({ error: "This item code already exists" }, { status: 409 })
      throw error
    }
    return NextResponse.json(data)
  } catch (error: any) {
    console.error("Error adding item code:", error)
    return NextResponse.json({ error: error.message || "Failed to add item code" }, { status: 500 })
  }
}

export async function PUT(request: Request) {
  try {
    const db = createAdminClient()
    const body = await request.json().catch(() => null)
    const codeId = Number(body?.code_id)
    if (!body || !Number.isInteger(codeId) || codeId < 1) return NextResponse.json({ error: "code_id is required" }, { status: 400 })
    const r = fieldsOf(body, true)
    if ("error" in r) return NextResponse.json({ error: r.error }, { status: 400 })
    if (Object.keys(r.fields).length === 0) return NextResponse.json({ error: "Nothing to change" }, { status: 400 })
    const { data, error } = await db.from("eta_item_codes").update(r.fields).eq("code_id", codeId).select().maybeSingle()
    if (error) {
      if (duplicate(error)) return NextResponse.json({ error: "This item code already exists" }, { status: 409 })
      throw error
    }
    if (!data) return NextResponse.json({ error: "Item code not found" }, { status: 404 })
    return NextResponse.json(data)
  } catch (error: any) {
    console.error("Error editing item code:", error)
    return NextResponse.json({ error: error.message || "Failed to edit item code" }, { status: 500 })
  }
}
