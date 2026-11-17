import { createAdminClient } from "@/lib/supabase/admin"
import { NextResponse } from "next/server"
import { codeChangeRefusal } from "@/lib/eta/code-roles"
import { actorUserId } from "@/lib/auth/actor"
import { knownUserId } from "@/lib/po-history"
import { normalizeName } from "@/lib/eta/normalize"
import { rememberCode, setProductCodeIfEmpty } from "@/lib/eta/store"
import { PREPARE_BATCH } from "@/lib/eta/codes"

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

// POST { name, codeId, unitType, productId? } confirms one line; POST { items: [...] } (at most PREPARE_BATCH) confirms
// several ("Classify waiting invoices" sends chunks). Each is remembered as 'confirmed'; a line of a stock product
// whose card has no code yet also gives the card that code. -> { success, saved, failed, productsSet }
export async function POST(request: Request) {
  try {
    // only the accountant (CEO, admin) decides codes - checked here as well as by the /api/eta rule
    const refused = codeChangeRefusal(request)
    if (refused) return NextResponse.json(refused, { status: 403 })
    const db = createAdminClient()
    const body = await request.json().catch(() => null)
    if (!body || typeof body !== "object") return NextResponse.json({ error: "Invalid body" }, { status: 400 })
    const many = Array.isArray(body.items)
    const items: any[] = many ? body.items : [body]
    if (items.length > PREPARE_BATCH) return NextResponse.json({ error: `Send at most ${PREPARE_BATCH} items per request` }, { status: 400 })
    const userId = await knownUserId(db, actorUserId(request))
    let saved = 0
    let productsSet = 0
    const failed: { name: string; error: string }[] = []
    for (const item of items) {
      const codeId = Number(item?.codeId)
      try {
        await rememberCode(db, { name: item?.name, codeId, unitType: item?.unitType, userId, source: "confirmed" })
        saved++
      } catch (e: any) {
        if (!many) return NextResponse.json({ error: e.message || "Could not save" }, { status: 400 })
        failed.push({ name: String(item?.name ?? ""), error: e.message || "failed" })
        continue
      }
      const productIds: unknown[] = Array.isArray(item?.productIds) ? item.productIds : item?.productId != null ? [item.productId] : []
      for (const pid of productIds) if (await setProductCodeIfEmpty(db, pid, codeId)) productsSet++
    }
    return NextResponse.json({ success: failed.length === 0, saved, failed, productsSet })
  } catch (error: any) {
    console.error("Error confirming code:", error)
    return NextResponse.json({ error: error.message || "Failed to save" }, { status: 500 })
  }
}

export async function DELETE(request: Request) {
  try {
    // only the accountant (CEO, admin) decides codes - checked here as well as by the /api/eta rule
    const refused = codeChangeRefusal(request)
    if (refused) return NextResponse.json(refused, { status: 403 })
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
