import { createAdminClient } from "@/lib/supabase/admin"
import { NextResponse } from "next/server"
import { allRows, parseBrands, readEtaSettings } from "@/lib/eta/store"
import { evaluate } from "@/lib/eta/predict"

export const dynamic = "force-dynamic"
export const maxDuration = 60

// GET: how well the item-code prediction does on the real memory (leave-one-out): { green: { n, correct },
// orange: { n, correct }, red, total }. For tuning the thresholds in lib/eta/predict.ts. Read-only. CEO / admin only
// (its own rule in lib/auth/permissions.ts).
export async function GET(_request: Request) {
  try {
    const db = createAdminClient()
    const [memory, codes, settings] = await Promise.all([
      allRows(db, "eta_code_memory", "normalized_name, core_name, code_id, source, memory_id", [{ column: "memory_id" }]),
      allRows(db, "eta_item_codes", "code_id, name, active", [{ column: "code_id" }]),
      readEtaSettings(db),
    ])
    return NextResponse.json(evaluate(memory, codes, parseBrands(settings.eta_brands)))
  } catch (error: any) {
    console.error("Error evaluating the code prediction:", error)
    return NextResponse.json({ error: "Could not evaluate the prediction" }, { status: 500 })
  }
}
