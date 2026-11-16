import { createAdminClient } from "@/lib/supabase/admin"
import { NextResponse } from "next/server"
import { actorUserId } from "@/lib/auth/actor"
import { knownUserId } from "@/lib/po-history"
import { ETA_SETTING_KEYS, readEtaSettings } from "@/lib/eta/store"
import { cairoMidnightIso, cairoToday, goLiveStarted } from "@/lib/eta/go-live"
import { toLatinDigits } from "@/lib/eta/egypt"

export const dynamic = "force-dynamic"


function clean(key: string, raw: unknown): { value: string } | { error: string } {
  const text = raw == null ? "" : String(raw).trim()
  if (key === "eta_rin") {
    const v = toLatinDigits(text).replace(/[\s-]/g, "")
    return /^\d{9}$/.test(v) ? { value: v } : { error: "eta_rin must be exactly 9 digits" }
  }
  if (key === "eta_activity_code") {
    const v = toLatinDigits(text).replace(/[\s-]/g, "")
    return /^\d{4}$/.test(v) ? { value: v } : { error: "eta_activity_code must be exactly 4 digits" }
  }
  if (key === "eta_go_live_at") {
    if (text === "") return { value: "" }
    const iso = cairoMidnightIso(toLatinDigits(text))
    return iso ? { value: iso } : { error: "eta_go_live_at must be a date as YYYY-MM-DD" }
  }
  if (key === "eta_environment") {
    return text === "test" || text === "real" ? { value: text } : { error: "eta_environment must be test or real" }
  }
  if (key === "eta_brands") {
    try {
      const v = JSON.parse(text)
      if (Array.isArray(v) && v.every((b) => typeof b === "string")) return { value: JSON.stringify(v) }
    } catch {
      /* fall through */
    }
    return { error: "eta_brands must be a JSON array of names" }
  }
  return { value: text }
}

export async function GET(_request: Request) {
  try {
    const db = createAdminClient()
    return NextResponse.json(await readEtaSettings(db))
  } catch (error: any) {
    console.error("Error reading e-invoice settings:", error)
    return NextResponse.json({ error: "Failed to read settings" }, { status: 500 })
  }
}

export async function PUT(request: Request) {
  try {
    const db = createAdminClient()
    const body = await request.json().catch(() => null)
    if (!body || typeof body !== "object") return NextResponse.json({ error: "Invalid body" }, { status: 400 })

    const updates: Record<string, string> = {}
    for (const key of ETA_SETTING_KEYS) {
      if (!(key in body)) continue
      const r = clean(key, (body as any)[key])
      if ("error" in r) return NextResponse.json({ error: r.error }, { status: 400 })
      updates[key] = r.value
    }

    const current = await readEtaSettings(db)
    const roles = (request.headers.get("x-mm-roles") || "").split(",").map((r) => r.trim())
    const top = roles.includes("ceo") || roles.includes("admin")
    // the portal (test / real) is chosen by the CEO or an admin only; unset counts as test, as the screen shows it
    if ("eta_environment" in updates && updates.eta_environment !== (current.eta_environment || "test") && !top) {
      return NextResponse.json({ error: "Only the CEO or an admin can choose the test or real portal" }, { status: 403 })
    }
    if ("eta_go_live_at" in updates && updates.eta_go_live_at !== (current.eta_go_live_at ?? "")) {
      if (!top) {
        return NextResponse.json({ error: "Only the CEO or an admin can change the go-live date" }, { status: 403 })
      }
      // once it has passed, invoices already exist on each side of it: moving or clearing it would re-classify them
      if (goLiveStarted(current.eta_go_live_at)) {
        return NextResponse.json({ error: "E-invoicing has already started on this date; it can't be changed" }, { status: 409 })
      }
      // a new go-live is a Cairo date after today, so no invoice that already exists falls after it
      if (updates.eta_go_live_at !== "" && updates.eta_go_live_at.slice(0, 10) <= cairoToday()) {
        return NextResponse.json({ error: "The go-live date must be after today (tomorrow or later)" }, { status: 400 })
      }
    }

    const userId = await knownUserId(db, actorUserId(request))
    const now = new Date().toISOString()
    for (const [key, value] of Object.entries(updates)) {
      const { error } = await db
        .from("company_settings")
        .upsert({ setting_key: key, setting_value: value, updated_at: now, updated_by: userId }, { onConflict: "setting_key" })
      if (error) throw error
    }
    return NextResponse.json(await readEtaSettings(db))
  } catch (error: any) {
    console.error("Error updating e-invoice settings:", error)
    return NextResponse.json({ error: error.message || "Failed to update settings" }, { status: 500 })
  }
}
