"use client"

import { useMemo, useState } from "react"
import useSWR from "swr"
import { Camera, Loader2, Plus, RefreshCw, Trash2 } from "lucide-react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { useToast } from "@/hooks/use-toast"
import { useI18n } from "@/lib/i18n-context"
import { formatDate, formatMoney } from "@/lib/format"
import { WorkerLinksManager } from "./worker-links-manager"

interface DraftLine {
  name: string
  quantity: number
  unitPrice: number
}
interface Draft {
  id: number
  createdAt: string
  status: "waiting" | "converting"
  readStatus: "reading" | "read" | "failed"
  read: {
    customerName: string
    date: string
    lines: DraftLine[]
    printedNumber?: string
    cancelled?: boolean
    writtenVat?: number
    writtenTotal?: number
  } | null
  workerName: string
}
interface Customer {
  id: number
  name: string
}

const fetcher = (url: string) => fetch(url).then((r) => (r.ok ? r.json() : Promise.reject(r)))
const VAT_RATE = 0.14

const TEXT = {
  en: {
    title: "Photos from the workshop",
    description: "Handwritten maintenance invoices sent by the workers. Check each one, then create the MINV invoice.",
    empty: "No photos waiting.",
    reading: "Reading…",
    readFailed: "Could not read",
    ready: "Ready to check",
    from: "From",
    open: "Check",
    dialogTitle: "Check the photo",
    customer: "Customer",
    customerSearch: "Search customer",
    readAs: "Written on the photo",
    lines: "Lines (prices before VAT)",
    item: "Item",
    qty: "Qty",
    price: "Price",
    addLine: "Add line",
    subtotal: "Before VAT",
    vat: "VAT 14%",
    total: "Total",
    create: "Create MINV invoice",
    reject: "Reject",
    rejectReason: "Reason (optional)",
    confirmReject: "Reject photo",
    reread: "Read again",
    created: (n: string) => `Invoice ${n} created`,
    rejected: "Photo rejected",
    rereading: "Reading the photo again",
    failed: "Something went wrong",
    pickCustomer: "Pick the customer",
    photoAlt: "Photo of the handwritten invoice",
    pageNumber: "Number printed on the page",
    pageNumberHint: "Needed when the worker uses a booklet. Leave empty otherwise.",
    cancelledPage: "This page looks cancelled",
    cancelPage: "Cancel page",
    confirmCancelPage: "Cancel this page number",
    cancelledDone: (n: string) => `Page ${n} cancelled`,
    needNumber: "Enter the page number first",
    mismatch: (vat: string, total: string) => `On the page: VAT ${vat}, total ${total}. Check the lines.`,
  },
  ar: {
    title: "صور من الورشة",
    description: "فواتير صيانة مكتوبة بخط اليد أرسلها العمال. راجع كل واحدة ثم أنشئ فاتورة MINV.",
    empty: "لا توجد صور في الانتظار.",
    reading: "جاري القراءة…",
    readFailed: "تعذرت القراءة",
    ready: "جاهزة للمراجعة",
    from: "من",
    open: "مراجعة",
    dialogTitle: "مراجعة الصورة",
    customer: "العميل",
    customerSearch: "ابحث عن عميل",
    readAs: "المكتوب في الصورة",
    lines: "البنود (الأسعار قبل الضريبة)",
    item: "البند",
    qty: "الكمية",
    price: "السعر",
    addLine: "إضافة بند",
    subtotal: "قبل الضريبة",
    vat: "ضريبة 14%",
    total: "الإجمالي",
    create: "إنشاء فاتورة MINV",
    reject: "رفض",
    rejectReason: "السبب (اختياري)",
    confirmReject: "رفض الصورة",
    reread: "قراءة مرة أخرى",
    created: (n: string) => `تم إنشاء الفاتورة ${n}`,
    rejected: "تم رفض الصورة",
    rereading: "جاري قراءة الصورة مرة أخرى",
    failed: "حدث خطأ",
    pickCustomer: "اختر العميل",
    photoAlt: "صورة الفاتورة المكتوبة بخط اليد",
    pageNumber: "الرقم المطبوع على الورقة",
    pageNumberHint: "مطلوب إذا كان العامل يستخدم دفتر. اتركه فارغاً غير ذلك.",
    cancelledPage: "هذه الورقة تبدو ملغاة",
    cancelPage: "إلغاء الورقة",
    confirmCancelPage: "إلغاء رقم هذه الورقة",
    cancelledDone: (n: string) => `تم إلغاء الورقة ${n}`,
    needNumber: "اكتب رقم الورقة أولاً",
    mismatch: (vat: string, total: string) => `في الورقة: الضريبة ${vat}، الإجمالي ${total}. راجع البنود.`,
  },
}

export function MaintenancePhotoDrafts() {
  const { language } = useI18n()
  const text = TEXT[language === "ar" ? "ar" : "en"]
  const { data, mutate } = useSWR<{ drafts: Draft[] }>("/api/maintenance/photo-drafts", fetcher, {
    refreshInterval: 20000,
    revalidateOnFocus: true,
  })
  const drafts = data?.drafts ?? []
  const [openId, setOpenId] = useState<number | null>(null)
  const open = drafts.find((d) => d.id === openId) ?? null

  const statusBadge = (d: Draft) =>
    d.status === "converting" || d.readStatus === "reading" ? (
      <Badge variant="secondary" className="gap-1">
        <Loader2 className="size-3 animate-spin" aria-hidden="true" />
        {text.reading}
      </Badge>
    ) : d.readStatus === "failed" ? (
      <Badge variant="destructive">{text.readFailed}</Badge>
    ) : (
      <Badge>{text.ready}</Badge>
    )

  return (
    <Card>
      <CardHeader className="gap-1">
        <CardTitle className="flex items-center gap-2 text-lg">
          <Camera className="size-5" aria-hidden="true" />
          {text.title}
          {drafts.length > 0 && <Badge variant="secondary">{drafts.length}</Badge>}
        </CardTitle>
        <CardDescription className="text-pretty">{text.description}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {drafts.length === 0 ? (
          <p className="text-sm text-muted-foreground">{text.empty}</p>
        ) : (
          <ul className="flex flex-col divide-y divide-border rounded-lg border border-border">
            {drafts.map((d) => (
              <li key={d.id} className="flex items-center justify-between gap-3 p-3">
                <div className="flex min-w-0 flex-col gap-1">
                  <span className="truncate font-medium">
                    {d.read?.customerName || `${text.from} ${d.workerName}`}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {d.read?.printedNumber ? `${d.read.printedNumber} · ` : ""}
                    {d.workerName} · {formatDate(d.createdAt, language)}
                  </span>
                  <span>{statusBadge(d)}</span>
                </div>
                <Button
                  size="sm"
                  className="min-h-11 shrink-0"
                  disabled={d.status === "converting" || d.readStatus === "reading"}
                  onClick={() => setOpenId(d.id)}
                >
                  {text.open}
                </Button>
              </li>
            ))}
          </ul>
        )}
        <WorkerLinksManager />
      </CardContent>

      {open && (
        <DraftDialog
          key={open.id}
          draft={open}
          text={text}
          onClose={() => setOpenId(null)}
          onDone={() => {
            setOpenId(null)
            mutate()
          }}
        />
      )}
    </Card>
  )
}

function DraftDialog({
  draft,
  text,
  onClose,
  onDone,
}: {
  draft: Draft
  text: (typeof TEXT)["en"]
  onClose: () => void
  onDone: () => void
}) {
  const { toast } = useToast()
  const { language } = useI18n()
  const [invoiceNumber, setInvoiceNumber] = useState(draft.read?.printedNumber ?? "")
  const [cancellingPage, setCancellingPage] = useState(false)
  const { data: customerData } = useSWR<{ customers: Customer[] }>("/api/maintenance/quick-invoice", fetcher)
  const customers = customerData?.customers ?? []
  const writtenName = draft.read?.customerName ?? ""
  const [search, setSearch] = useState(writtenName)
  const [customerId, setCustomerId] = useState<number | null>(null)
  const [lines, setLines] = useState<DraftLine[]>(
    draft.read?.lines?.length ? draft.read.lines : [{ name: "", quantity: 1, unitPrice: 0 }],
  )
  const [busy, setBusy] = useState<"create" | "reject" | "reread" | "void" | null>(null)
  const [rejecting, setRejecting] = useState(false)
  const [reason, setReason] = useState("")

  const matches = useMemo(() => {
    const q = search.trim().toLowerCase()
    const list = q ? customers.filter((c) => c.name.toLowerCase().includes(q)) : customers
    return list.slice(0, 8)
  }, [customers, search])
  const chosen = customers.find((c) => c.id === customerId) ?? null

  const subtotal = lines.reduce((sum, l) => sum + (Number(l.quantity) || 0) * (Number(l.unitPrice) || 0), 0)
  const vat = Math.round(subtotal * VAT_RATE * 100) / 100
  const validLines = lines.filter((l) => l.name.trim() && Number(l.quantity) > 0 && Number(l.unitPrice) > 0)
  const writtenVat = draft.read?.writtenVat ?? 0
  const writtenTotal = draft.read?.writtenTotal ?? 0
  const totalsDiffer =
    (writtenVat > 0 && Math.abs(writtenVat - vat) > 1) || (writtenTotal > 0 && Math.abs(writtenTotal - (subtotal + vat)) > 1)

  const setLine = (i: number, patch: Partial<DraftLine>) =>
    setLines((all) => all.map((l, j) => (j === i ? { ...l, ...patch } : l)))

  const post = async (body: Record<string, unknown>) => {
    const response = await fetch(`/api/maintenance/photo-drafts/${draft.id}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    })
    const result = await response.json().catch(() => ({}))
    if (!response.ok) throw new Error(result?.error || text.failed)
    return result
  }

  const run = async (kind: "create" | "reject" | "reread" | "void") => {
    setBusy(kind)
    try {
      if (kind === "void") {
        if (!invoiceNumber.trim()) throw new Error(text.needNumber)
        const result = await post({ action: "void", invoiceNumber, reason })
        toast({ title: text.cancelledDone(result.invoiceNumber) })
      } else if (kind === "create") {
        const result = await post({
          action: "create",
          invoiceNumber: invoiceNumber.trim() || undefined,
          customerId,
          lines: validLines.map((l) => ({ name: l.name.trim(), quantity: Number(l.quantity), unitPrice: Number(l.unitPrice) })),
        })
        toast({ title: text.created(result.invoiceNumber) })
      } else if (kind === "reject") {
        await post({ action: "reject", reason })
        toast({ title: text.rejected })
      } else {
        await post({ action: "reread" })
        toast({ title: text.rereading })
      }
      onDone()
    } catch (error: any) {
      toast({ title: text.failed, description: error?.message, variant: "destructive" })
    } finally {
      setBusy(null)
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[92dvh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{text.dialogTitle}</DialogTitle>
          <DialogDescription>
            {draft.workerName} · {formatDate(draft.createdAt, language)}
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-5 md:flex-row">
          <a
            href={`/api/maintenance/photo-drafts/${draft.id}/photo`}
            target="_blank"
            rel="noreferrer"
            className="block shrink-0 overflow-hidden rounded-lg border border-border md:w-64"
          >
            {/* eslint-disable-next-line @next/next/no-img-element -- private photo served by our own route */}
            <img
              src={`/api/maintenance/photo-drafts/${draft.id}/photo`}
              alt={text.photoAlt}
              className="max-h-80 w-full object-contain md:max-h-none"
            />
          </a>

          <div className="flex min-w-0 flex-1 flex-col gap-4">
            {draft.read?.cancelled && (
              <p role="alert" className="rounded-md border border-destructive bg-destructive/10 p-2 text-sm font-medium text-destructive">
                {text.cancelledPage}
              </p>
            )}
            <div className="flex flex-col gap-2">
              <Label htmlFor="draft-number">{text.pageNumber}</Label>
              <Input
                id="draft-number"
                value={invoiceNumber}
                onChange={(e) => setInvoiceNumber(e.target.value.toUpperCase())}
                placeholder="MINV265600"
                autoCapitalize="characters"
                autoComplete="off"
                dir="ltr"
                className="min-h-11 font-mono text-base"
              />
              <p className="text-xs text-muted-foreground text-pretty">{text.pageNumberHint}</p>
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="draft-customer">{text.customer}</Label>
              {writtenName && (
                <p className="text-xs text-muted-foreground">
                  {text.readAs}: <span className="font-medium text-foreground">{writtenName}</span>
                </p>
              )}
              {chosen ? (
                <div className="flex items-center justify-between gap-2 rounded-md border border-primary bg-primary/5 p-2">
                  <span className="truncate font-medium">{chosen.name}</span>
                  <Button variant="ghost" size="sm" className="min-h-11" onClick={() => setCustomerId(null)}>
                    {text.customerSearch}
                  </Button>
                </div>
              ) : (
                <>
                  <Input
                    id="draft-customer"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder={text.customerSearch}
                    className="min-h-11 text-base"
                  />
                  <ul className="flex max-h-40 flex-col overflow-y-auto rounded-md border border-border">
                    {matches.map((c) => (
                      <li key={c.id}>
                        <button
                          type="button"
                          onClick={() => setCustomerId(c.id)}
                          className="min-h-11 w-full px-3 py-2 text-start text-sm hover:bg-muted"
                        >
                          {c.name}
                        </button>
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </div>

            <div className="flex flex-col gap-2">
              <Label>{text.lines}</Label>
              {lines.map((line, i) => (
                <div key={i} className="flex flex-wrap items-end gap-2 rounded-md border border-border p-2">
                  <div className="flex min-w-40 flex-1 flex-col gap-1">
                    <span className="text-xs text-muted-foreground">{text.item}</span>
                    <Input
                      value={line.name}
                      onChange={(e) => setLine(i, { name: e.target.value })}
                      aria-label={text.item}
                      className="min-h-11 text-base"
                    />
                  </div>
                  <div className="flex w-20 flex-col gap-1">
                    <span className="text-xs text-muted-foreground">{text.qty}</span>
                    <Input
                      type="number"
                      inputMode="decimal"
                      min={0}
                      value={line.quantity}
                      onChange={(e) => setLine(i, { quantity: Number(e.target.value) })}
                      aria-label={text.qty}
                      className="min-h-11 text-base"
                    />
                  </div>
                  <div className="flex w-28 flex-col gap-1">
                    <span className="text-xs text-muted-foreground">{text.price}</span>
                    <Input
                      type="number"
                      inputMode="decimal"
                      min={0}
                      value={line.unitPrice}
                      onChange={(e) => setLine(i, { unitPrice: Number(e.target.value) })}
                      aria-label={text.price}
                      className="min-h-11 text-base"
                    />
                  </div>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-11"
                    aria-label={`${text.reject} ${line.name}`}
                    disabled={lines.length === 1}
                    onClick={() => setLines((all) => all.filter((_, j) => j !== i))}
                  >
                    <Trash2 className="size-4" aria-hidden="true" />
                  </Button>
                </div>
              ))}
              <Button
                variant="outline"
                size="sm"
                className="min-h-11 self-start"
                onClick={() => setLines((all) => [...all, { name: "", quantity: 1, unitPrice: 0 }])}
              >
                <Plus className="size-4" aria-hidden="true" />
                {text.addLine}
              </Button>
            </div>

            <dl className="flex flex-col gap-1 rounded-md bg-muted p-3 text-sm">
              <div className="flex justify-between">
                <dt>{text.subtotal}</dt>
                <dd className="tabular-nums">{formatMoney(subtotal, language)}</dd>
              </div>
              <div className="flex justify-between">
                <dt>{text.vat}</dt>
                <dd className="tabular-nums">{formatMoney(vat, language)}</dd>
              </div>
              <div className="flex justify-between font-bold">
                <dt>{text.total}</dt>
                <dd className="tabular-nums">{formatMoney(subtotal + vat, language)}</dd>
              </div>
            </dl>
            {totalsDiffer && (
              <p role="alert" className="rounded-md border border-destructive bg-destructive/10 p-2 text-sm text-destructive text-pretty">
                {text.mismatch(formatMoney(writtenVat, language), formatMoney(writtenTotal, language))}
              </p>
            )}

            {(rejecting || cancellingPage) && (
              <div className="flex flex-col gap-2">
                <Label htmlFor="draft-reason">{text.rejectReason}</Label>
                <Textarea id="draft-reason" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={300} className="text-base" />
              </div>
            )}
          </div>
        </div>

        <DialogFooter className="flex-col gap-2 sm:flex-row">
          <Button variant="outline" className="min-h-11" disabled={!!busy} onClick={() => run("reread")}>
            {busy === "reread" ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : <RefreshCw className="size-4" aria-hidden="true" />}
            {text.reread}
          </Button>
          {cancellingPage ? (
            <Button variant="destructive" className="min-h-11" disabled={!!busy} onClick={() => run("void")}>
              {busy === "void" && <Loader2 className="size-4 animate-spin" aria-hidden="true" />}
              {text.confirmCancelPage}
            </Button>
          ) : rejecting ? (
            <Button variant="destructive" className="min-h-11" disabled={!!busy} onClick={() => run("reject")}>
              {busy === "reject" && <Loader2 className="size-4 animate-spin" aria-hidden="true" />}
              {text.confirmReject}
            </Button>
          ) : (
            <>
              {(draft.read?.cancelled || invoiceNumber.trim()) && (
                <Button variant="outline" className="min-h-11" disabled={!!busy} onClick={() => setCancellingPage(true)}>
                  {text.cancelPage}
                </Button>
              )}
              <Button variant="outline" className="min-h-11" disabled={!!busy} onClick={() => setRejecting(true)}>
                {text.reject}
              </Button>
            </>
          )}
          <Button
            className="min-h-11"
            disabled={!!busy || !customerId || validLines.length === 0}
            title={!customerId ? text.pickCustomer : undefined}
            onClick={() => run("create")}
          >
            {busy === "create" && <Loader2 className="size-4 animate-spin" aria-hidden="true" />}
            {text.create}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
