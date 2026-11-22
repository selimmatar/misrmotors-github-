"use client"

import { useState } from "react"
import useSWR from "swr"
import { Hash, Loader2, TriangleAlert } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { useToast } from "@/hooks/use-toast"
import { useI18n } from "@/lib/i18n-context"
import type { OfficeNumbersView } from "@/lib/shared-invoice-numbers"

const fetcher = (url: string) => fetch(url).then((r) => (r.ok ? r.json() : null))

const TEXT = {
  en: {
    title: "Shared invoice numbers",
    hint: "Sales invoices and the maintenance booklet use one number sequence. The worker reserves a page number before writing; your next sales invoice takes the next free number.",
    off: "Not on yet. Enter the first number to use (the next red number in the booklet). Until then the old INV / MINV numbering stays.",
    highest: (n: number) => `Highest invoice number in the system now: ${n}`,
    startLabel: "Starting number",
    turnOn: "Turn on",
    on: (n: number) => `On since number ${n}`,
    sales: "Sales",
    maintenance: "Maintenance",
    reserved: "reserved",
    used: "used",
    released: "free again",
    photo: "photo sent",
    overdue: (list: string) => `Reserved since before today with no photo: ${list}. Call the worker, or cancel the number.`,
    next: (n: number) => `Next number: ${n}`,
    nextHint: "A number cancelled before its invoice was made is free again and goes out first.",
    cancel: "Cancel",
    cancelled: (n: number) => `${n} cancelled. It is free again: the next invoice takes it.`,
    saved: "Shared numbering is on",
    empty: "No numbers handed out yet.",
    failed: "Something went wrong",
    loading: "Loading",
  },
  ar: {
    title: "أرقام الفواتير المشتركة",
    hint: "فواتير المبيعات ودفتر الصيانة لهم تسلسل أرقام واحد. مهندس الصيانة يحجز رقم الصفحة قبل ما يكتب، وفاتورة المبيعات الجاية بتاخد أول رقم فاضي.",
    off: "لسه مش شغال. اكتب أول رقم هيستخدم (الرقم الأحمر الجاي في الدفتر). لحد كده الترقيم القديم INV / MINV شغال.",
    highest: (n: number) => `أعلى رقم فاتورة في النظام دلوقتي: ${n}`,
    startLabel: "رقم البداية",
    turnOn: "تشغيل",
    on: (n: number) => `شغال من رقم ${n}`,
    sales: "مبيعات",
    maintenance: "صيانة",
    reserved: "محجوز",
    used: "مستخدم",
    released: "رجع فاضي",
    photo: "الصورة وصلت",
    overdue: (list: string) => `محجوز من قبل النهارده ومفيش صورة: ${list}. كلّم مهندس الصيانة أو ألغي الرقم.`,
    next: (n: number) => `الرقم الجاي: ${n}`,
    nextHint: "أي رقم اتلغى قبل ما الفاتورة تتعمل بيرجع فاضي وبيطلع الأول.",
    cancel: "إلغاء",
    cancelled: (n: number) => `تم إلغاء ${n}. رجع فاضي والفاتورة الجاية هتاخده.`,
    saved: "الترقيم المشترك اشتغل",
    empty: "لسه مفيش أرقام اتصرفت.",
    failed: "حصل خطأ",
    loading: "جارٍ التحميل",
  },
}

async function send(url: string, method: string, body: unknown) {
  const response = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })
  const data = await response.json().catch(() => null)
  if (!response.ok) throw new Error(data?.error || "Request failed")
  return data
}

export function SharedInvoiceNumbers() {
  const { language } = useI18n()
  const text = TEXT[language === "ar" ? "ar" : "en"]
  const { toast } = useToast()
  const { data, mutate, isLoading } = useSWR<OfficeNumbersView | null>("/api/maintenance/shared-numbers", fetcher, { refreshInterval: 30_000 })
  const [start, setStart] = useState("")
  const [busy, setBusy] = useState<string | null>(null)

  const run = async (key: string, task: () => Promise<void>) => {
    setBusy(key)
    try {
      await task()
      await mutate()
    } catch (error: any) {
      toast({ title: text.failed, description: error?.message, variant: "destructive" })
    } finally {
      setBusy(null)
    }
  }

  const statusLabel = (s: OfficeNumbersView["recent"][number]) =>
    s.status === "used" ? text.used : s.status === "released" ? text.released : s.draft_id ? text.photo : text.reserved

  return (
    <section aria-labelledby="shared-numbers-title" className="flex flex-col gap-3 border-t border-border pt-4">
      <div className="flex flex-col gap-1">
        <h3 id="shared-numbers-title" className="flex items-center gap-2 font-semibold">
          <Hash className="size-4" aria-hidden="true" />
          {text.title}
        </h3>
        <p className="text-sm leading-relaxed text-muted-foreground text-pretty">{text.hint}</p>
      </div>

      {isLoading ? (
        <Loader2 className="size-5 animate-spin text-muted-foreground" aria-label={text.loading} />
      ) : !data ? (
        <p className="text-sm text-destructive">{text.failed}</p>
      ) : !data.start ? (
        <form
          className="flex flex-col gap-3 rounded-lg border border-border p-3"
          onSubmit={(event) => {
            event.preventDefault()
            run("start", async () => {
              await send("/api/maintenance/shared-numbers", "POST", { start })
              toast({ title: text.saved })
            })
          }}
        >
          <p className="text-sm leading-relaxed text-pretty">{text.off}</p>
          {data.highestExisting ? <p className="text-sm text-muted-foreground">{text.highest(data.highestExisting)}</p> : null}
          <div className="flex flex-col gap-2">
            <Label htmlFor="shared-start">{text.startLabel}</Label>
            <div className="flex gap-2">
              <Input
                id="shared-start"
                dir="ltr"
                inputMode="numeric"
                pattern="[0-9]*"
                value={start}
                onChange={(event) => setStart(event.target.value.replace(/\D/g, ""))}
                placeholder={data.highestExisting ? String(data.highestExisting + 1) : "10558"}
                className="min-h-11 font-mono text-base"
              />
              <Button type="submit" className="min-h-11" disabled={!start || busy === "start"}>
                {busy === "start" && <Loader2 className="size-4 animate-spin" aria-hidden="true" />}
                {text.turnOn}
              </Button>
            </div>
          </div>
        </form>
      ) : (
        <div className="flex flex-col gap-3">
          <Badge variant="secondary" className="self-start">
            {text.on(data.start)}
          </Badge>
          {data.nextNumber ? (
            <p className="flex flex-col gap-0.5 text-sm">
              <span className="font-semibold">
                {text.next(data.nextNumber)}
              </span>
              <span className="text-muted-foreground text-pretty">{text.nextHint}</span>
            </p>
          ) : null}

          {data.overdue.length ? (
            <div role="alert" className="flex items-start gap-2 rounded-lg bg-warning/15 p-3 text-sm leading-relaxed">
              <TriangleAlert className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden="true" />
              <span className="text-pretty">{text.overdue(data.overdue.join(", "))}</span>
            </div>
          ) : null}

          {data.recent.length ? (
            <ul className="flex flex-col divide-y divide-border rounded-lg border border-border">
              {data.recent.map((s) => {
                const held = s.kind === "maintenance" && s.status === "reserved" && !s.draft_id
                return (
                  <li key={s.number} className="flex min-h-11 items-center justify-between gap-3 px-3 py-2">
                    <div className="flex min-w-0 flex-col">
                      <span className="flex items-center gap-2">
                        <span dir="ltr" className="font-mono font-semibold">
                          {s.number}
                        </span>
                        <Badge variant={s.kind === "maintenance" ? "default" : "outline"}>
                          {s.kind === "maintenance" ? text.maintenance : text.sales}
                        </Badge>
                      </span>
                      <span className="truncate text-xs text-muted-foreground">
                        {statusLabel(s)}
                        {s.worker_name ? ` · ${s.worker_name}` : ""}
                      </span>
                    </div>
                    {held ? (
                      <Button
                        variant="outline"
                        size="sm"
                        className="min-h-11"
                        disabled={busy === `x${s.number}`}
                        onClick={() =>
                          run(`x${s.number}`, async () => {
                            await send("/api/maintenance/shared-numbers", "PATCH", { number: s.number })
                            toast({ title: text.cancelled(s.number) })
                          })
                        }
                      >
                        {busy === `x${s.number}` && <Loader2 className="size-4 animate-spin" aria-hidden="true" />}
                        {text.cancel}
                      </Button>
                    ) : null}
                  </li>
                )
              })}
            </ul>
          ) : (
            <p className="text-sm text-muted-foreground">{text.empty}</p>
          )}
        </div>
      )}
    </section>
  )
}
