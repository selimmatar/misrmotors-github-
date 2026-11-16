"use client"

// A light item-code picker. With hundreds of portal codes, one full drop-down per row froze the page (every closed
// Radix Select still builds all its options). This shows only the current choice until opened, then a search box
// and at most 50 matches.
import { useMemo, useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { useI18n } from "@/lib/i18n-context"

export interface PickerCode {
  code_id: number
  item_code: string
  name?: string | null
  active?: boolean | null
}

const MAX_SHOWN = 50

export function EtaCodePicker({
  codes,
  value,
  onChange,
  ariaLabel,
  noneLabel,
  disabled,
}: {
  codes: PickerCode[]
  value: number | null
  onChange: (codeId: number | null) => void
  ariaLabel: string
  noneLabel: string
  disabled?: boolean
}) {
  const { t } = useI18n()
  const [open, setOpen] = useState(false)
  const [q, setQ] = useState("")
  const label = (c: PickerCode) =>
    `${c.item_code}${c.name ? ` - ${c.name}` : ""}${c.active === false ? ` (${t("eta.code-inactive")})` : ""}`
  const current = value == null ? null : codes.find((c) => c.code_id === value) ?? null
  const matches = useMemo(() => {
    if (!open) return []
    const s = q.trim().toLowerCase()
    return codes
      .filter((c) => c.active !== false || c.code_id === value)
      .filter((c) => !s || `${c.item_code} ${c.name ?? ""}`.toLowerCase().includes(s))
      .slice(0, MAX_SHOWN)
  }, [open, q, codes, value])

  const pick = (id: number | null) => {
    onChange(id)
    setOpen(false)
    setQ("")
  }

  if (!open) {
    return (
      <Button
        type="button"
        variant="outline"
        className="w-full justify-start truncate"
        aria-label={ariaLabel}
        disabled={disabled}
        onClick={() => setOpen(true)}
      >
        <span className="truncate">{current ? label(current) : noneLabel}</span>
      </Button>
    )
  }
  return (
    <div className="space-y-2 rounded-md border p-2">
      <div className="flex gap-2">
        <Input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("eta.codes-search")} aria-label={ariaLabel} />
        <Button type="button" variant="ghost" onClick={() => { setOpen(false); setQ("") }}>
          {t("eta.cancel")}
        </Button>
      </div>
      <ul className="max-h-64 overflow-y-auto divide-y">
        <li>
          <button type="button" className="w-full p-2 text-start text-sm hover:bg-muted" onClick={() => pick(null)}>
            {noneLabel}
          </button>
        </li>
        {matches.map((c) => (
          <li key={c.code_id}>
            <button
              type="button"
              className={`w-full p-2 text-start text-sm hover:bg-muted ${c.code_id === value ? "font-semibold" : ""}`}
              onClick={() => pick(c.code_id)}
            >
              {label(c)}
            </button>
          </li>
        ))}
      </ul>
    </div>
  )
}
