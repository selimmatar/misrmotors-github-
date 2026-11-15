// Server-side access to the e-invoice settings, item codes and name memory (spec sections 7 and 8).
import { normalizeName, coreName, DEFAULT_BRANDS } from "./normalize"
import type { EtaCode, MemoryRow } from "./codes"

type Db = any

const PAGE = 1000

export interface OrderBy {
  column: string
  ascending?: boolean
}

/**
 * Reads every row of a table in pages (PostgREST caps one read). `order` must end in a unique column (the primary key)
 * so that rows tied on the earlier columns come back in the same order on every page.
 */
export async function allRows(db: Db, table: string, select: string, order: OrderBy[]): Promise<any[]> {
  const rows: any[] = []
  for (let from = 0; ; from += PAGE) {
    let query = db.from(table).select(select)
    for (const o of order) query = query.order(o.column, { ascending: o.ascending !== false })
    const { data, error } = await query.range(from, from + PAGE - 1)
    if (error) throw new Error(`Could not read ${table}: ${error.message || JSON.stringify(error)}`)
    const page = (data || []) as any[]
    rows.push(...page)
    if (page.length < PAGE) return rows
  }
}

export const ETA_SETTING_KEYS = [
  "eta_rin",
  "eta_registered_name",
  "eta_activity_code",
  "eta_branch_id",
  "eta_branch_governorate",
  "eta_branch_region",
  "eta_branch_street",
  "eta_branch_building_number",
  "eta_environment",
  "eta_go_live_at",
  "eta_brands",
] as const
export type EtaSettingKey = (typeof ETA_SETTING_KEYS)[number]

export async function readEtaSettings(db: Db): Promise<Record<string, string>> {
  const { data, error } = await db.from("company_settings").select("setting_key, setting_value").in("setting_key", [...ETA_SETTING_KEYS])
  if (error) throw new Error(error.message || "Could not read the e-invoice settings")
  const out: Record<string, string> = {}
  for (const r of (data || []) as any[]) out[r.setting_key] = r.setting_value == null ? "" : String(r.setting_value)
  return out
}

export function parseBrands(raw: string | undefined | null): string[] {
  if (!raw) return DEFAULT_BRANDS
  try {
    const v = JSON.parse(raw)
    if (Array.isArray(v)) return v.map((b) => normalizeName(String(b))).filter(Boolean)
  } catch {
    /* fall through */
  }
  return DEFAULT_BRANDS
}

export async function loadMatchContext(db: Db): Promise<{ codes: EtaCode[]; memory: MemoryRow[]; brands: string[] }> {
  const [codeRows, memRows, settings] = await Promise.all([
    allRows(db, "eta_item_codes", "code_id, item_code, name, keywords, default_unit, active", [{ column: "code_id" }]),
    allRows(db, "eta_code_memory", "normalized_name, core_name, code_id, unit_type, confirmed_at, memory_id", [{ column: "confirmed_at" }, { column: "memory_id" }]),
    readEtaSettings(db),
  ])
  const codes: EtaCode[] = codeRows.map((c) => ({
    codeId: c.code_id,
    itemCode: c.item_code,
    name: c.name || "",
    keywords: Array.isArray(c.keywords) ? c.keywords : [],
    defaultUnit: c.default_unit || "EA",
    active: c.active !== false,
  }))
  const memory: MemoryRow[] = memRows.map((m) => ({
    normalizedName: m.normalized_name,
    coreName: m.core_name || "",
    codeId: m.code_id,
    unitType: m.unit_type || "EA",
  }))
  return { codes, memory, brands: parseBrands(settings.eta_brands) }
}

export interface RememberInput {
  name: string
  codeId: number
  unitType: string
  userId: number | null
  source: "confirmed" | "imported"
}

/** Learn name -> code. One row per normalised name (latest wins), plus one keyed by the core name when it differs. */
export async function rememberCode(db: Db, input: RememberInput): Promise<void> {
  const name = String(input.name ?? "").trim()
  const normalized = normalizeName(name)
  if (!normalized) throw new Error("A name is required")
  const codeId = Number(input.codeId)
  if (!Number.isInteger(codeId) || codeId < 1) throw new Error("A valid item code is required")
  const { data: code, error: codeErr } = await db.from("eta_item_codes").select("code_id, default_unit, active").eq("code_id", codeId).maybeSingle()
  if (codeErr) throw new Error(codeErr.message || "Could not read the item code")
  if (!code) throw new Error("Item code not found")
  if (code.active === false) throw new Error("Item code is inactive")
  const unitType = String(input.unitType || "").trim() || code.default_unit || "EA"

  const { data: settingRows } = await db.from("company_settings").select("setting_key, setting_value").eq("setting_key", "eta_brands")
  const brands = parseBrands(settingRows?.[0]?.setting_value)
  const core = coreName(normalized, brands)
  const now = new Date().toISOString()

  const save = async (key: string, coreOfRow: string, sample: string) => {
    const { data: existing, error } = await db.from("eta_code_memory").select("memory_id").eq("normalized_name", key).maybeSingle()
    if (error) throw new Error(error.message || "Could not read the code memory")
    const row: Record<string, any> = {
      normalized_name: key,
      core_name: coreOfRow,
      code_id: codeId,
      unit_type: unitType,
      source: input.source,
      confirmed_by: input.userId,
      confirmed_at: now,
    }
    if (!existing) row.sample_name = sample
    const res = await db.from("eta_code_memory").upsert(row, { onConflict: "normalized_name" })
    if (res.error) throw new Error(res.error.message || "Could not save the code memory")
  }

  await save(normalized, core, name)
  if (core && core !== normalized) await save(core, core, core)
}
