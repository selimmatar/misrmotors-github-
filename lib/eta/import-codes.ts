// "Import codes from portal": reads the company's approved EGS code requests from the ETA portal (read-only) and
// adds them to eta_item_codes. New codes are inserted active; a code already there only gets its name updated.
// Nothing is deleted or deactivated and eta_code_memory is never touched.
import type { EtaPortal } from "./portal"

type Db = any

export const IMPORT_PAGE_SIZE = 100
const MAX_PAGES = 500 // safety stop
const ARABIC = /[؀-ۿ]/

export interface ImportResult { imported: number; updated: number; unchanged: number; failed: number; pages: number }

/** Arabic name first, the other language after " / ". The SDK documents codeName (English); newer / other responses carry primary / secondary names. */
export function codeNameOf(r: any): string {
  const names = [r?.codeNameAr, r?.codeNameSecondaryLang, r?.codeNamePrimaryLang, r?.codeName]
    .map((v) => (typeof v === "string" ? v.trim() : ""))
    .filter(Boolean)
  const uniq = [...new Set(names)]
  const ar = uniq.find((n) => ARABIC.test(n))
  const other = uniq.find((n) => n !== ar)
  return ar && other ? `${ar} / ${other}` : ar || other || ""
}

export async function importCodesFromPortal(db: Db, portal: EtaPortal, createdBy: number | null): Promise<ImportResult> {
  const found = new Map<string, { code_type: "EGS" | "GS1"; name: string }>()
  let failed = 0
  let pages = 0
  for (let pageNo = 1; pageNo <= MAX_PAGES; pageNo++) {
    const body: any = await portal.myCodes({ pageNo, pageSize: IMPORT_PAGE_SIZE })
    const list: any[] = Array.isArray(body) ? body : Array.isArray(body?.result) ? body.result : []
    if (list.length === 0 && pageNo > 1) break
    pages++
    for (const r of list) {
      const item_code = String(r?.itemCode ?? "").trim()
      const type = String(r?.codeTypeName ?? "EGS").trim().toUpperCase()
      const name = codeNameOf(r)
      if (!item_code || !name || (type !== "EGS" && type !== "GS1") || r?.active === false) { failed++; continue }
      found.set(item_code, { code_type: type, name })
    }
    const totalPages = Number(body?.metadata?.totalPages)
    if (Number.isFinite(totalPages) && totalPages > 0 ? pageNo >= totalPages : list.length === 0) break
  }

  const { data, error } = await db.from("eta_item_codes").select("code_id, item_code, name")
  if (error) throw new Error(error.message || "Could not read the item codes")
  const existing = new Map<string, { code_id: number; name: string }>(((data || []) as any[]).map((r) => [String(r.item_code), r]))

  let imported = 0
  let updated = 0
  let unchanged = 0
  const fresh: any[] = []
  for (const [item_code, f] of found) {
    const have = existing.get(item_code)
    if (!have) { fresh.push({ item_code, code_type: f.code_type, name: f.name, keywords: [], default_unit: "EA", active: true, created_by: createdBy }); continue }
    if (have.name === f.name) { unchanged++; continue }
    const { error: e } = await db.from("eta_item_codes").update({ name: f.name }).eq("code_id", have.code_id)
    if (e) failed++
    else updated++
  }
  for (let i = 0; i < fresh.length; i += 100) {
    const batch = fresh.slice(i, i + 100)
    const { error: e } = await db.from("eta_item_codes").insert(batch)
    if (!e) { imported += batch.length; continue }
    for (const row of batch) {
      const { error: e1 } = await db.from("eta_item_codes").insert(row)
      if (e1) failed++
      else imported++
    }
  }
  return { imported, updated, unchanged, failed, pages }
}
