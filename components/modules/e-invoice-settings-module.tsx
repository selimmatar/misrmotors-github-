"use client"

// E-invoice settings (spec §9; accountant, CEO, admin): the company's tax details and portal, the go-live date (CEO /
// admin only), the accountant's item codes, the remembered names, "Prepare from past items" and the brand words.
import { useCallback, useEffect, useMemo, useState } from "react"
import { Loader2, Pencil, Plus, RefreshCw, Trash2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import { PageHeader } from "@/components/erp/page-header"
import { StatePill, readError, type EtaCodeRow } from "@/components/accounting/eta-preview-dialog"
import { useToast } from "@/hooks/use-toast"
import { useI18n } from "@/lib/i18n-context"
import { fill } from "@/lib/i18n-format"
import { ETA_UNITS, GOVERNORATES, toLatinDigits } from "@/lib/eta/egypt"
import { EtaSignerCard } from "@/components/accounting/eta-signer-card"
import { cairoTomorrow, canSetGoLive, goLiveDate, goLiveStarted } from "@/lib/eta/go-live"
import { DEFAULT_BRANDS } from "@/lib/eta/normalize"
import { chunk, prepareRowsToPost, PREPARE_BATCH, type CodeState } from "@/lib/eta/codes"

const NONE = "none"
const PAGE = 100

const COMPANY_FIELDS = [
  { key: "eta_rin", label: "eta.company-rin", ltr: true },
  { key: "eta_registered_name", label: "eta.company-name" },
  { key: "eta_activity_code", label: "eta.activity-code", ltr: true },
  { key: "eta_branch_id", label: "eta.branch-id", ltr: true },
  { key: "eta_branch_governorate", label: "eta.governorate" },
  { key: "eta_branch_region", label: "eta.region" },
  { key: "eta_branch_street", label: "eta.street" },
  { key: "eta_branch_building_number", label: "eta.building-number" },
] as const
const COMPANY_KEYS = [...COMPANY_FIELDS.map((f) => f.key), "eta_environment"]

interface MemoryRow {
  memory_id: number
  normalized_name: string
  sample_name?: string | null
  code_id: number
  unit_type?: string | null
}

interface PrepareItem {
  name: string
  normalizedName: string
  count: number
  codeId: number | null
  state: CodeState
  unit: string
}
interface PrepareRow extends PrepareItem {
  pick: string
  skip: boolean
}

const EMPTY_CODE = { item_code: "", code_type: "EGS", name: "", keywords: "", default_unit: "EA" }

const digitsOnly = (s: string) => toLatinDigits(s).replace(/[\s-]/g, "")

export function EInvoiceSettingsModule({ roles }: { roles: readonly string[] }) {
  const { t, language } = useI18n()
  const { toast } = useToast()
  const mayGoLive = canSetGoLive(roles)

  const [settings, setSettings] = useState<Record<string, string> | null>(null)
  const [loadError, setLoadError] = useState(false)
  const [company, setCompany] = useState<Record<string, string>>({})
  const [goLive, setGoLive] = useState("")
  const [brands, setBrands] = useState("")
  const [saving, setSaving] = useState<string | null>(null)

  const [codes, setCodes] = useState<EtaCodeRow[]>([])
  const [codeForm, setCodeForm] = useState(EMPTY_CODE)
  const [editingCode, setEditingCode] = useState<number | null>(null)

  const [memory, setMemory] = useState<MemoryRow[]>([])
  const [memoryQuery, setMemoryQuery] = useState("")

  const [prepare, setPrepare] = useState<PrepareRow[] | null>(null)
  const [prepareShown, setPrepareShown] = useState(PAGE)
  const [preparing, setPreparing] = useState(false)
  const [prepareProgress, setPrepareProgress] = useState<{ done: number; total: number } | null>(null)

  const failed = useCallback(
    (e: unknown) =>
      toast({ title: t("message.error"), description: fill(t("eta.save-failed"), { error: e instanceof Error ? e.message : String(e) }), variant: "destructive" }),
    [t, toast],
  )

  const applySettings = (s: Record<string, string>) => {
    setSettings(s)
    setCompany(Object.fromEntries(COMPANY_KEYS.map((k) => [k, s[k] ?? (k === "eta_environment" ? "test" : "")])))
    setGoLive(goLiveDate(s.eta_go_live_at))
    let list: string[] = DEFAULT_BRANDS
    try {
      const parsed = s.eta_brands ? JSON.parse(s.eta_brands) : null
      if (Array.isArray(parsed)) list = parsed.map(String)
    } catch {
      /* keep the starting list */
    }
    setBrands(list.join("\n"))
  }

  const loadSettings = useCallback(async () => {
    setLoadError(false)
    try {
      const res = await fetch("/api/eta/settings")
      if (!res.ok) throw new Error(String(res.status))
      applySettings(await res.json())
    } catch {
      setLoadError(true)
    }
  }, [])

  const loadCodes = useCallback(async () => {
    try {
      const res = await fetch("/api/eta/codes")
      const rows = res.ok ? await res.json() : []
      setCodes(Array.isArray(rows) ? rows : [])
    } catch {
      setCodes([])
    }
  }, [])

  const loadMemory = useCallback(async (q: string) => {
    try {
      const res = await fetch(`/api/eta/memory?q=${encodeURIComponent(q.trim())}`)
      const rows = res.ok ? await res.json() : []
      setMemory(Array.isArray(rows) ? rows : [])
    } catch {
      setMemory([])
    }
  }, [])

  useEffect(() => {
    loadSettings()
    loadCodes()
  }, [loadSettings, loadCodes])

  useEffect(() => {
    const timer = setTimeout(() => loadMemory(memoryQuery), 300)
    return () => clearTimeout(timer)
  }, [memoryQuery, loadMemory])

  const codeById = useMemo(() => new Map(codes.map((c) => [c.code_id, c])), [codes])
  const codeLabel = (c: EtaCodeRow) => `${c.item_code}${c.name ? ` - ${c.name}` : ""}${c.active === false ? ` (${t("eta.code-inactive")})` : ""}`
  /** active codes, plus `keep` so a picker never shows blank */
  const codeOptions = (keep: number | null) => codes.filter((c) => c.active !== false || c.code_id === keep)

  const put = async (what: string, body: Record<string, string>) => {
    setSaving(what)
    try {
      const res = await fetch("/api/eta/settings", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })
      if (!res.ok) throw new Error(await readError(res, t("message.error")))
      applySettings(await res.json())
      toast({ title: t("eta.saved") })
    } catch (e) {
      failed(e)
    } finally {
      setSaving(null)
    }
  }

  const saveCompany = () => {
    const rin = digitsOnly(company.eta_rin || "")
    const activity = digitsOnly(company.eta_activity_code || "")
    if (rin && !/^\d{9}$/.test(rin)) return failed(new Error(t("eta.rin-invalid")))
    if (activity && !/^\d{4}$/.test(activity)) return failed(new Error(t("eta.activity-invalid")))
    // only what changed: an empty number that was never set is not sent (the server needs it complete when sent)
    const body: Record<string, string> = {}
    for (const k of COMPANY_KEYS) if ((company[k] ?? "") !== (settings?.[k] ?? "") && (k !== "eta_environment" || mayGoLive)) body[k] = company[k] ?? ""
    if (Object.keys(body).length === 0) return toast({ title: t("eta.saved") })
    put("company", body)
  }

  const saveGoLive = () => {
    if (!mayGoLive || goLiveStarted(settings?.eta_go_live_at)) return
    if (goLive && goLive < cairoTomorrow()) return failed(new Error(t("eta.go-live-too-early")))
    if (!window.confirm(goLive ? fill(t("eta.go-live-confirm"), { date: goLive }) : t("eta.go-live-clear-confirm"))) return
    put("go-live", { eta_go_live_at: goLive })
  }

  const saveBrands = () => {
    const list = [...new Set(brands.split(/[\n,،]/).map((b) => b.trim()).filter(Boolean))]
    put("brands", { eta_brands: JSON.stringify(list) })
  }

  // ---- item codes
  const saveCode = async () => {
    if (!codeForm.item_code.trim() || !codeForm.name.trim()) return failed(new Error(t("eta.code-required")))
    setSaving("code")
    try {
      const body = { ...codeForm, ...(editingCode != null ? { code_id: editingCode } : {}) }
      const res = await fetch("/api/eta/codes", {
        method: editingCode != null ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      })
      if (!res.ok) throw new Error(res.status === 409 ? t("eta.code-duplicate") : await readError(res, t("message.error")))
      toast({ title: t("eta.saved") })
      setCodeForm(EMPTY_CODE)
      setEditingCode(null)
      await loadCodes()
    } catch (e) {
      failed(e)
    } finally {
      setSaving(null)
    }
  }

  const importCodes = async () => {
    if (!window.confirm(t("eta.import-codes-confirm"))) return
    setSaving("import")
    try {
      const res = await fetch("/api/eta/codes/import", { method: "POST" })
      if (!res.ok) throw new Error(await readError(res, t("message.error")))
      const r = await res.json()
      toast({ title: t("eta.import-codes"), description: fill(t("eta.import-codes-result"), { imported: r.imported, updated: r.updated, unchanged: r.unchanged, failed: r.failed, pages: r.pages }) })
      await loadCodes()
    } catch (e) {
      failed(e)
    } finally {
      setSaving(null)
    }
  }

  const editCode = (c: EtaCodeRow) => {
    setEditingCode(c.code_id)
    setCodeForm({
      item_code: c.item_code || "",
      code_type: c.code_type === "GS1" ? "GS1" : "EGS",
      name: c.name || "",
      keywords: (c.keywords || []).join(", "),
      default_unit: c.default_unit || "EA",
    })
  }

  const toggleCode = async (c: EtaCodeRow) => {
    try {
      const res = await fetch("/api/eta/codes", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code_id: c.code_id, active: c.active === false }),
      })
      if (!res.ok) throw new Error(await readError(res, t("message.error")))
      await loadCodes()
    } catch (e) {
      failed(e)
    }
  }

  // ---- remembered names
  const changeMemory = async (row: MemoryRow, codeId: string) => {
    if (codeId === NONE) return
    try {
      const res = await fetch("/api/eta/memory", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: row.sample_name || row.normalized_name, codeId: Number(codeId), unitType: row.unit_type || "" }),
      })
      if (!res.ok) throw new Error(await readError(res, t("message.error")))
      toast({ title: t("eta.saved") })
      await loadMemory(memoryQuery)
    } catch (e) {
      failed(e)
    }
  }

  const removeMemory = async (row: MemoryRow) => {
    if (!window.confirm(fill(t("eta.memory-remove-confirm"), { name: row.sample_name || row.normalized_name }))) return
    try {
      const res = await fetch(`/api/eta/memory?id=${row.memory_id}`, { method: "DELETE" })
      if (!res.ok) throw new Error(await readError(res, t("message.error")))
      toast({ title: t("eta.memory-removed") })
      await loadMemory(memoryQuery)
    } catch (e) {
      failed(e)
    }
  }

  // ---- prepare from past items
  const startPrepare = async () => {
    setPreparing(true)
    try {
      const res = await fetch("/api/eta/memory/prepare")
      if (!res.ok) throw new Error(await readError(res, t("message.error")))
      const body = await res.json()
      const items: PrepareItem[] = Array.isArray(body?.items) ? body.items : []
      setPrepare(items.map((i) => ({ ...i, pick: i.codeId != null ? String(i.codeId) : NONE, skip: false })))
      setPrepareShown(PAGE)
    } catch (e) {
      failed(e)
    } finally {
      setPreparing(false)
    }
  }

  const setPrepareRow = (normalizedName: string, patch: Partial<PrepareRow>) =>
    setPrepare((rows) => (rows || []).map((r) => (r.normalizedName === normalizedName ? { ...r, ...patch } : r)))

  const toConfirm = prepareRowsToPost(prepare || [], codes)

  // sent in chunks of PREPARE_BATCH, one request after the other; a chunk that fails stops the run and is reported
  const confirmAll = async () => {
    if (toConfirm.length === 0) return
    setSaving("prepare")
    const total = toConfirm.length
    let done = 0
    let saved = 0
    let skipped = 0
    let failedRows = 0
    let stopped: unknown = null
    setPrepareProgress({ done, total })
    try {
      for (const part of chunk(toConfirm, PREPARE_BATCH)) {
        try {
          const res = await fetch("/api/eta/memory/prepare", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ items: part }),
          })
          if (!res.ok) throw new Error(await readError(res, t("message.error")))
          const out = await res.json()
          saved += out.saved ?? 0
          skipped += out.skipped ?? 0
          failedRows += Array.isArray(out.failed) ? out.failed.length : 0
        } catch (e) {
          stopped = e
          break
        }
        done += part.length
        setPrepareProgress({ done, total })
      }
      toast({
        title: fill(t("eta.prepare-done"), { saved, skipped, failed: failedRows + (total - done) }),
        variant: failedRows > 0 || stopped ? "destructive" : undefined,
      })
      if (stopped) failed(stopped)
      await loadMemory(memoryQuery)
      await startPrepare()
    } catch (e) {
      failed(e)
    } finally {
      setPrepareProgress(null)
      setSaving(null)
    }
  }

  if (loadError) {
    return (
      <div className="space-y-6">
        <PageHeader group={t("group.finance")} title={t("module.e-invoice-settings")} subtitle={t("eta.settings-subtitle")} />
        <div role="alert" className="rounded-lg border border-destructive/40 bg-destructive/10 p-4 space-y-2">
          <p className="font-medium">{t("eta.load-failed")}</p>
          <Button variant="outline" size="sm" onClick={loadSettings}>
            <RefreshCw className="w-4 h-4 me-2" />
            {t("eta.retry")}
          </Button>
        </div>
      </div>
    )
  }

  if (!settings) {
    return (
      <p className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="w-4 h-4 animate-spin" />
        {t("eta.loading")}
      </p>
    )
  }

  // go-live (final review I1): a new date is tomorrow or later; once the stored date has passed it is read-only
  const goLiveMin = cairoTomorrow()
  const started = goLiveStarted(settings.eta_go_live_at)

  return (
    <div className="space-y-6">
      <PageHeader group={t("group.finance")} title={t("module.e-invoice-settings")} subtitle={t("eta.settings-subtitle")} />

      {/* Company tax details and portal */}
      <Card>
        <CardHeader>
          <CardTitle>{t("eta.company-section")}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            {COMPANY_FIELDS.map((f) =>
              f.key === "eta_branch_governorate" ? (
                <div key={f.key} className="space-y-1">
                  <Label htmlFor="eta-company-governorate">{t(f.label)}</Label>
                  <Select value={company[f.key] || NONE} onValueChange={(v) => setCompany((c) => ({ ...c, [f.key]: v === NONE ? "" : v }))}>
                    <SelectTrigger id="eta-company-governorate">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={NONE}>{t("eta.none")}</SelectItem>
                      {GOVERNORATES.map((g) => (
                        <SelectItem key={g.en} value={g.en}>
                          {language === "ar" ? g.ar : g.en}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              ) : (
                <div key={f.key} className="space-y-1">
                  <Label htmlFor={`eta-company-${f.key}`}>{t(f.label)}</Label>
                  <Input
                    id={`eta-company-${f.key}`}
                    value={company[f.key] || ""}
                    dir={"ltr" in f && f.ltr ? "ltr" : undefined}
                    inputMode={"ltr" in f && f.ltr ? "numeric" : undefined}
                    onChange={(e) => setCompany((c) => ({ ...c, [f.key]: e.target.value }))}
                  />
                </div>
              ),
            )}
            <div className="space-y-1">
              <Label htmlFor="eta-environment">{t("eta.environment")}</Label>
              <Select value={company.eta_environment || "test"} onValueChange={(v) => setCompany((c) => ({ ...c, eta_environment: v }))} disabled={!mayGoLive}>
                <SelectTrigger id="eta-environment">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {["test", "real"].map((env) => (
                    <SelectItem key={env} value={env}>
                      {t(`eta.env-${env}`)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {!mayGoLive && <p className="text-xs text-muted-foreground">{t("eta.environment-only-top")}</p>}
            </div>
          </div>
          <Button onClick={saveCompany} disabled={saving !== null}>
            {saving === "company" && <Loader2 className="w-4 h-4 me-2 animate-spin" />}
            {t("eta.save")}
          </Button>
        </CardContent>
      </Card>

      <EtaSignerCard mayManage={mayGoLive} />

      {/* Go-live */}
      <Card>
        <CardHeader>
          <CardTitle>{t("eta.go-live-section")}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm text-muted-foreground">{t("eta.go-live-help")}</p>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
            <div className="space-y-1">
              <Label htmlFor="eta-go-live">{t("eta.go-live")}</Label>
              <Input
                id="eta-go-live"
                type="date"
                value={goLive}
                onChange={(e) => setGoLive(e.target.value)}
                disabled={!mayGoLive || saving !== null}
                min={goLiveMin}
                readOnly={started}
                className="sm:w-48"
              />
            </div>
            <Button onClick={saveGoLive} disabled={!mayGoLive || started || saving !== null || goLive === goLiveDate(settings.eta_go_live_at)}>
              {saving === "go-live" && <Loader2 className="w-4 h-4 me-2 animate-spin" />}
              {t("eta.save")}
            </Button>
          </div>
          <p className="text-sm">
            {started
              ? fill(t("eta.go-live-started"), { date: goLiveDate(settings.eta_go_live_at) })
              : settings.eta_go_live_at
                ? fill(t("eta.go-live-is"), { date: goLiveDate(settings.eta_go_live_at) })
                : t("eta.go-live-not-set")}
          </p>
          {!mayGoLive && <p className="text-sm text-muted-foreground">{t("eta.go-live-only-top")}</p>}
        </CardContent>
      </Card>

      {/* Item codes */}
      <Card>
        <CardHeader>
          <CardTitle>{t("eta.codes-section")}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">{t("eta.codes-help")}</p>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5 lg:items-end">
            <div className="space-y-1">
              <Label htmlFor="eta-code-item-code">{t("eta.code")}</Label>
              <Input id="eta-code-item-code" dir="ltr" value={codeForm.item_code} onChange={(e) => setCodeForm((f) => ({ ...f, item_code: e.target.value }))} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="eta-code-type">{t("eta.code-type")}</Label>
              <Select value={codeForm.code_type} onValueChange={(v) => setCodeForm((f) => ({ ...f, code_type: v }))}>
                <SelectTrigger id="eta-code-type">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="EGS">EGS</SelectItem>
                  <SelectItem value="GS1">GS1</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label htmlFor="eta-code-name">{t("eta.code-name")}</Label>
              <Input id="eta-code-name" value={codeForm.name} onChange={(e) => setCodeForm((f) => ({ ...f, name: e.target.value }))} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="eta-code-keywords">{t("eta.keywords")}</Label>
              <Input id="eta-code-keywords" value={codeForm.keywords} onChange={(e) => setCodeForm((f) => ({ ...f, keywords: e.target.value }))} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="eta-code-unit">{t("eta.default-unit")}</Label>
              <Select value={codeForm.default_unit} onValueChange={(v) => setCodeForm((f) => ({ ...f, default_unit: v }))}>
                <SelectTrigger id="eta-code-unit">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {ETA_UNITS.map((u) => (
                    <SelectItem key={u} value={u}>
                      {u} - {t(`eta.unit-${u}`)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button onClick={saveCode} disabled={saving !== null}>
              {editingCode == null && <Plus className="w-4 h-4 me-2" />}
              {editingCode == null ? t("eta.code-add") : t("eta.save")}
            </Button>
            <Button variant="outline" onClick={importCodes} disabled={saving !== null}>
              {saving === "import" ? t("eta.import-codes-busy") : t("eta.import-codes")}
            </Button>
            {editingCode != null && (
              <Button
                variant="outline"
                onClick={() => {
                  setEditingCode(null)
                  setCodeForm(EMPTY_CODE)
                }}
              >
                {t("eta.cancel")}
              </Button>
            )}
          </div>
          {codes.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t("eta.no-codes")}</p>
          ) : (
            <ul className="divide-y rounded-lg border">
              {codes.map((c) => (
                <li key={c.code_id} className="flex flex-col gap-2 p-3 sm:flex-row sm:items-center sm:justify-between">
                  <div className="min-w-0">
                    <p className="font-medium break-words">
                      <bdi dir="ltr" className="font-mono">{c.item_code}</bdi> <span className="text-xs text-muted-foreground">{c.code_type}</span>
                      {c.active === false && <span className="ms-2 text-xs text-muted-foreground">({t("eta.code-inactive")})</span>}
                    </p>
                    <p className="text-sm break-words">{c.name}</p>
                    <p className="text-xs text-muted-foreground break-words">
                      {t("eta.default-unit")}: {c.default_unit || "EA"}
                      {c.keywords && c.keywords.length > 0 ? ` · ${t("eta.keywords-short")}: ${c.keywords.join(", ")}` : ""}
                    </p>
                  </div>
                  <div className="flex shrink-0 gap-2">
                    <Button size="sm" variant="outline" aria-label={`${t("eta.code-edit")} ${c.item_code}`} onClick={() => editCode(c)}>
                      <Pencil className="w-4 h-4" />
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => toggleCode(c)}>
                      {c.active === false ? t("eta.code-switch-on") : t("eta.code-switch-off")}
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      {/* Prepare from past items */}
      <Card>
        <CardHeader>
          <CardTitle>{t("eta.prepare-section")}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">{t("eta.prepare-help")}</p>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={startPrepare} disabled={preparing || saving !== null}>
              {preparing ? <Loader2 className="w-4 h-4 me-2 animate-spin" /> : <RefreshCw className="w-4 h-4 me-2" />}
              {t("eta.prepare-start")}
            </Button>
            {prepare && prepare.length > 0 && (
              <Button onClick={confirmAll} disabled={saving !== null || toConfirm.length === 0}>
                {saving === "prepare" && <Loader2 className="w-4 h-4 me-2 animate-spin" />}
                {fill(t("eta.prepare-confirm-all"), { n: toConfirm.length })}
              </Button>
            )}
          </div>
          {prepareProgress && (
            <p role="status" className="text-sm text-muted-foreground">
              {fill(t("eta.prepare-progress"), { done: prepareProgress.done, total: prepareProgress.total })}
            </p>
          )}
          {prepare && prepare.length === 0 && <p className="text-sm text-muted-foreground">{t("eta.prepare-empty")}</p>}
          {prepare && prepare.length > 0 && (
            <ul className="divide-y rounded-lg border">
              {prepare.slice(0, prepareShown).map((r) => (
                <li key={r.normalizedName} className={`flex flex-col gap-2 p-3 sm:flex-row sm:items-center ${r.skip ? "opacity-60" : ""}`}>
                  <div className="min-w-0 flex-1">
                    <p className="font-medium break-words">{r.name}</p>
                    <p className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                      {fill(t("eta.prepare-times"), { n: r.count })}
                      <StatePill state={r.pick === NONE ? "red" : r.state} />
                    </p>
                  </div>
                  <div className="sm:w-72">
                    <Select value={r.pick} onValueChange={(v) => setPrepareRow(r.normalizedName, { pick: v, state: v === NONE ? "red" : "green" })}>
                      <SelectTrigger aria-label={`${t("eta.item-code")} ${r.name}`}>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value={NONE}>{t("eta.choose-code")}</SelectItem>
                        {codeOptions(r.codeId).map((c) => (
                          <SelectItem key={c.code_id} value={String(c.code_id)}>
                            {codeLabel(c)}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="flex items-center gap-2">
                    <Checkbox
                      id={`eta-skip-${r.normalizedName}`}
                      checked={r.skip}
                      onCheckedChange={(v) => setPrepareRow(r.normalizedName, { skip: v === true })}
                    />
                    <Label htmlFor={`eta-skip-${r.normalizedName}`}>{t("eta.prepare-skip")}</Label>
                  </div>
                </li>
              ))}
            </ul>
          )}
          {prepare && prepare.length > prepareShown && (
            <Button variant="outline" onClick={() => setPrepareShown((n) => n + PAGE)}>
              {fill(t("eta.show-more"), { n: prepare.length - prepareShown })}
            </Button>
          )}
        </CardContent>
      </Card>

      {/* Remembered names */}
      <Card>
        <CardHeader>
          <CardTitle>{t("eta.memory-section")}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">{t("eta.memory-help")}</p>
          <div className="space-y-1 sm:w-80">
            <Label htmlFor="eta-memory-search">{t("eta.memory-search")}</Label>
            <Input id="eta-memory-search" type="search" value={memoryQuery} onChange={(e) => setMemoryQuery(e.target.value)} />
          </div>
          {memory.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t("eta.memory-empty")}</p>
          ) : (
            <ul className="divide-y rounded-lg border">
              {memory.map((m) => {
                const code = codeById.get(m.code_id)
                return (
                  <li key={m.memory_id} className="flex flex-col gap-2 p-3 sm:flex-row sm:items-center">
                    <div className="min-w-0 flex-1">
                      <p className="font-medium break-words">{m.sample_name || m.normalized_name}</p>
                      <p className="text-xs text-muted-foreground">
                        {t("eta.unit")}: {m.unit_type || "EA"}
                      </p>
                    </div>
                    <div className="sm:w-72">
                      <Select value={code ? String(m.code_id) : NONE} onValueChange={(v) => changeMemory(m, v)}>
                        <SelectTrigger aria-label={`${t("eta.item-code")} ${m.sample_name || m.normalized_name}`}>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value={NONE}>{t("eta.choose-code")}</SelectItem>
                          {codeOptions(m.code_id).map((c) => (
                            <SelectItem key={c.code_id} value={String(c.code_id)}>
                              {codeLabel(c)}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <Button
                      size="sm"
                      variant="outline"
                      aria-label={`${t("eta.memory-remove")} ${m.sample_name || m.normalized_name}`}
                      onClick={() => removeMemory(m)}
                    >
                      <Trash2 className="w-4 h-4" />
                    </Button>
                  </li>
                )
              })}
            </ul>
          )}
        </CardContent>
      </Card>

      {/* Brand words */}
      <Card>
        <CardHeader>
          <CardTitle>{t("eta.brands-section")}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <Label htmlFor="eta-brands" className="text-sm font-normal text-muted-foreground">
            {t("eta.brands-help")}
          </Label>
          <Textarea id="eta-brands" rows={6} value={brands} onChange={(e) => setBrands(e.target.value)} />
          <Button onClick={saveBrands} disabled={saving !== null}>
            {saving === "brands" && <Loader2 className="w-4 h-4 me-2 animate-spin" />}
            {t("eta.save")}
          </Button>
        </CardContent>
      </Card>
    </div>
  )
}
