import { createAdminClient } from "@/lib/supabase/admin"
import { NextResponse } from "next/server"
import { actorUserId } from "@/lib/auth/actor"
import { knownUserId } from "@/lib/po-history"
import { normalizeName } from "@/lib/eta/normalize"
import { matchCode, PREPARE_BATCH } from "@/lib/eta/codes"
import { allRows, loadMatchContext, rememberCode } from "@/lib/eta/store"

export const dynamic = "force-dynamic"

export async function GET(_request: Request) {
  try {
    const db = createAdminClient()
    const [lines, products, ctx] = await Promise.all([
      allRows(db, "sales_order_items", "so_item_id, product_id, outsourced_name", [{ column: "so_item_id" }]),
      allRows(db, "products", "product_id, product_name, eta_code_id, eta_unit_type", [{ column: "product_id" }]),
      loadMatchContext(db),
    ])
    const productById = new Map<number, any>(products.map((p) => [p.product_id, p]))
    const inMemory = new Set(ctx.memory.map((m) => m.normalizedName))

    const groups = new Map<string, { spellings: Map<string, number>; count: number; productCodeId: number | null; productUnit: string | null }>()
    for (const line of lines) {
      const product = line.product_id != null ? productById.get(line.product_id) : null
      const name = String((line.product_id != null ? product?.product_name : line.outsourced_name) ?? "").trim()
      const key = normalizeName(name)
      if (!key || inMemory.has(key)) continue
      let g = groups.get(key)
      if (!g) groups.set(key, (g = { spellings: new Map(), count: 0, productCodeId: null, productUnit: null }))
      g.count++
      g.spellings.set(name, (g.spellings.get(name) || 0) + 1)
      if (g.productCodeId == null && product?.eta_code_id != null) {
        g.productCodeId = product.eta_code_id
        g.productUnit = product.eta_unit_type || null
      }
    }

    const items = [...groups.entries()].map(([normalizedName, g]) => {
      let name = ""
      let best = 0
      for (const [spelling, n] of g.spellings) if (n > best) ((best = n), (name = spelling))
      const m = matchCode({ name, productCodeId: g.productCodeId, productUnit: g.productUnit }, ctx)
      return { name, normalizedName, count: g.count, codeId: m.codeId, state: m.state, by: m.by, unit: m.unit }
    })
    items.sort((a, b) => b.count - a.count || a.normalizedName.localeCompare(b.normalizedName))
    return NextResponse.json({ items })
  } catch (error: any) {
    console.error("Error preparing code memory:", error)
    return NextResponse.json({ error: "Failed to prepare the code memory" }, { status: 500 })
  }
}

export async function POST(request: Request) {
  try {
    const db = createAdminClient()
    const body = await request.json().catch(() => null)
    if (!body || !Array.isArray(body.items)) return NextResponse.json({ error: "items is required" }, { status: 400 })
    // each row is several round trips: a bigger request could run past the time limit, so the screen sends chunks
    if (body.items.length > PREPARE_BATCH) {
      return NextResponse.json({ error: `Send at most ${PREPARE_BATCH} items per request` }, { status: 400 })
    }
    const userId = await knownUserId(db, actorUserId(request))
    let saved = 0
    let skipped = 0
    const failed: { name: string; error: string }[] = []
    for (const item of body.items) {
      if (!item || item.codeId == null || item.codeId === "") {
        skipped++
        continue
      }
      try {
        await rememberCode(db, { name: item.name, codeId: Number(item.codeId), unitType: item.unitType, userId, source: "imported" })
        saved++
      } catch (e: any) {
        failed.push({ name: String(item.name ?? ""), error: e.message || "failed" })
      }
    }
    return NextResponse.json({ saved, skipped, failed })
  } catch (error: any) {
    console.error("Error saving code memory:", error)
    return NextResponse.json({ error: error.message || "Failed to save" }, { status: 500 })
  }
}
