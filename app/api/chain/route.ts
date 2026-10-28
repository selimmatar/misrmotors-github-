import { createAdminClient } from "@/lib/supabase/admin"
import { parsePositiveId } from "@/lib/parse-id"
import { loadChain, type ChainStart } from "@/lib/po-requests/chain"
import { type NextRequest, NextResponse } from "next/server"

// GET ?quotation_id= | pr_id= | so_id= | po_id=  ->  { quotation, prs, so, pos }  (the quotation -> PR -> SO -> PO chain)
const START_KEYS = { quotation_id: "quotationId", pr_id: "prId", so_id: "soId", po_id: "poId" } as const

export async function GET(request: NextRequest) {
  try {
    const params = new URL(request.url).searchParams
    for (const [param, key] of Object.entries(START_KEYS)) {
      const raw = params.get(param)
      if (raw === null) continue
      const id = parsePositiveId(raw)
      if (id === null) return NextResponse.json({ error: `Invalid ${param}` }, { status: 400 })
      return NextResponse.json(await loadChain(createAdminClient(), { [key]: id } as ChainStart))
    }
    return NextResponse.json({ error: "One of quotation_id, pr_id, so_id or po_id is required" }, { status: 400 })
  } catch (error) {
    console.error("Error loading the document chain:", error)
    return NextResponse.json({ error: "Failed to load the document chain" }, { status: 500 })
  }
}
