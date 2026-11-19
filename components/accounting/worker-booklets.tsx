"use client"

import { useState } from "react"
import useSWR from "swr"
import { BookOpen, Loader2, Printer } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { useToast } from "@/hooks/use-toast"
import { useI18n } from "@/lib/i18n-context"

interface Booklet {
  id: number
  linkId: number
  workerName: string
  firstNumber: string
  lastNumber: string
  status: "active" | "finished"
  used: number
  voided: number
  blank: number
  skipped: string[]
}

const fetcher = (url: string) => fetch(url).then((r) => (r.ok ? r.json() : null))

const TEXT = {
  en: {
    title: "Invoice booklets",
    hint: "One booklet of 300 carbon pages is shared by all workers. Office MINV invoices take the next number in the same sequence. When it is finished, make the next one.",
    give: "New booklet",
    print: "Print",
    used: "used",
    voided: "cancelled",
    blank: "blank",
    finished: "Finished",
    finish: "Mark finished",
    reopen: "Reopen",
    skipped: (list: string) => `Pages skipped so far: ${list}. A photo may still be on its way, or the page is lost.`,
    lostPage: "Cancel a lost page",
    lostNumber: "Page number",
    confirmLost: "Cancel page",
    cancelled: (n: string) => `Page ${n} cancelled`,
    made: (a: string, b: string) => `Booklet ${a} – ${b} made`,
    failed: "Something went wrong",
  },
  ar: {
    title: "دفاتر الفواتير",
    hint: "دفتر واحد فيه 300 ورقة كربون مشترك بين كل العمال. فواتير MINV من المكتب تأخذ الرقم التالي في نفس التسلسل. عند انتهائه أنشئ الدفتر التالي.",
    give: "دفتر جديد",
    print: "طباعة",
    used: "مستخدمة",
    voided: "ملغاة",
    blank: "فارغة",
    finished: "انتهى",
    finish: "تحديد كمنتهي",
    reopen: "إعادة فتح",
    skipped: (list: string) => `أوراق متخطاة حتى الآن: ${list}. ربما الصورة في الطريق، أو الورقة ضاعت.`,
    lostPage: "إلغاء ورقة ضائعة",
    lostNumber: "رقم الورقة",
    confirmLost: "إلغاء الورقة",
    cancelled: (n: string) => `تم إلغاء الورقة ${n}`,
    made: (a: string, b: string) => `تم إنشاء الدفتر ${a} – ${b}`,
    failed: "حدث خطأ",
  },
}

export function WorkerBooklets() {
  const { language } = useI18n()
  const text = TEXT[language === "ar" ? "ar" : "en"]
  const { toast } = useToast()
  const { data, mutate } = useSWR<{ booklets: Booklet[] } | null>("/api/maintenance/booklets", fetcher)
  const [busy, setBusy] = useState<string | null>(null)
  const [lostFor, setLostFor] = useState<number | null>(null)
  const [lostNumber, setLostNumber] = useState("")

  if (!data) return null

  const call = async (key: string, method: "POST" | "PATCH", body: Record<string, unknown>) => {
    setBusy(key)
    try {
      const response = await fetch("/api/maintenance/booklets", {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      })
      const result = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(result?.error || text.failed)
      await mutate()
      return result
    } catch (error: any) {
      toast({ title: text.failed, description: error?.message, variant: "destructive" })
      return null
    } finally {
      setBusy(null)
    }
  }

  const hasOpenBooklet = data.booklets.some((b) => b.status === "active")

  return (
    <section aria-labelledby="booklets-title" className="flex flex-col gap-3 border-t border-border pt-4">
      <div className="flex flex-col gap-1">
        <h3 id="booklets-title" className="flex items-center gap-2 font-semibold">
          <BookOpen className="size-4" aria-hidden="true" />
          {text.title}
        </h3>
        <p className="text-sm text-muted-foreground text-pretty">{text.hint}</p>
      </div>

      {!hasOpenBooklet && (
        <Button
          variant="outline"
          className="min-h-11 self-start"
          disabled={busy === "new"}
          onClick={async () => {
            const made = await call("new", "POST", {})
            if (made) toast({ title: text.made(made.firstNumber, made.lastNumber) })
          }}
        >
          {busy === "new" && <Loader2 className="size-4 animate-spin" aria-hidden="true" />}
          {text.give}
        </Button>
      )}

      {data.booklets.length > 0 && (
        <ul className="flex flex-col divide-y divide-border rounded-lg border border-border">
          {data.booklets.map((b) => (
            <li key={b.id} className="flex flex-col gap-2 p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex min-w-0 flex-col gap-1">
                  <span className="flex flex-wrap items-center gap-2 font-medium">
                    <span dir="ltr" className="font-mono text-sm">
                      {b.firstNumber} – {b.lastNumber}
                    </span>
                    {b.status === "finished" && <Badge variant="secondary">{text.finished}</Badge>}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {b.used} {text.used} · {b.voided} {text.voided} · {b.blank} {text.blank}
                  </span>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button asChild variant="outline" size="sm" className="min-h-11">
                    <a href={`/api/maintenance/booklets/${b.id}/print`} target="_blank" rel="noreferrer">
                      <Printer className="size-4" aria-hidden="true" />
                      {text.print}
                    </a>
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    className="min-h-11"
                    disabled={busy === `s${b.id}`}
                    onClick={() => call(`s${b.id}`, "PATCH", { id: b.id, status: b.status === "active" ? "finished" : "active" })}
                  >
                    {b.status === "active" ? text.finish : text.reopen}
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="min-h-11"
                    onClick={() => {
                      setLostFor(lostFor === b.id ? null : b.id)
                      setLostNumber("")
                    }}
                  >
                    {text.lostPage}
                  </Button>
                </div>
              </div>

              {b.skipped.length > 0 && (
                <p className="rounded-md bg-muted p-2 text-xs text-pretty">
                  {text.skipped(b.skipped.slice(0, 10).join(", ") + (b.skipped.length > 10 ? "…" : ""))}
                </p>
              )}

              {lostFor === b.id && (
                <form
                  className="flex flex-col gap-2 sm:flex-row sm:items-end"
                  onSubmit={async (e) => {
                    e.preventDefault()
                    const done = await call(`v${b.id}`, "PATCH", { id: b.id, action: "void", invoiceNumber: lostNumber })
                    if (done) {
                      toast({ title: text.cancelled(lostNumber.toUpperCase()) })
                      setLostFor(null)
                    }
                  }}
                >
                  <div className="flex flex-1 flex-col gap-1">
                    <Label htmlFor={`lost-${b.id}`}>{text.lostNumber}</Label>
                    <Input
                      id={`lost-${b.id}`}
                      value={lostNumber}
                      onChange={(e) => setLostNumber(e.target.value.toUpperCase())}
                      placeholder={b.firstNumber}
                      dir="ltr"
                      autoComplete="off"
                      className="min-h-11 font-mono text-base"
                    />
                  </div>
                  <Button type="submit" variant="destructive" className="min-h-11" disabled={!lostNumber.trim() || busy === `v${b.id}`}>
                    {busy === `v${b.id}` && <Loader2 className="size-4 animate-spin" aria-hidden="true" />}
                    {text.confirmLost}
                  </Button>
                </form>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
