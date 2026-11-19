"use client"

import { useState } from "react"
import useSWR from "swr"
import { Check, Copy, Link2, Loader2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { useToast } from "@/hooks/use-toast"
import { useI18n } from "@/lib/i18n-context"
import { formatDate } from "@/lib/format"

interface WorkerLink {
  id: number
  workerName: string
  active: boolean
  createdAt: string
  lastUsedAt: string | null
}

// Only admin and CEO can load the links; for everyone else the request is refused and this section stays hidden.
const fetcher = (url: string) => fetch(url).then((r) => (r.ok ? r.json() : null))

const TEXT = {
  en: {
    title: "Worker photo links",
    hint: "Each worker gets a personal link. Open it on his phone and choose Add to Home Screen.",
    name: "Worker name",
    make: "Make link",
    newLink: (n: string) => `New link for ${n}. It is shown only now, so copy it and open it on his phone.`,
    copy: "Copy link",
    copied: "Copied",
    on: "On",
    off: "Off",
    turnOff: "Turn off",
    turnOn: "Turn on",
    replace: "New link",
    lastUsed: "Last photo",
    never: "never",
    failed: "Something went wrong",
  },
  ar: {
    title: "روابط صور العمال",
    hint: "لكل عامل رابط خاص. افتحه على موبايله واختر إضافة إلى الشاشة الرئيسية.",
    name: "اسم العامل",
    make: "إنشاء رابط",
    newLink: (n: string) => `رابط جديد لـ ${n}. يظهر الآن فقط، انسخه وافتحه على موبايله.`,
    copy: "نسخ الرابط",
    copied: "تم النسخ",
    on: "يعمل",
    off: "متوقف",
    turnOff: "إيقاف",
    turnOn: "تشغيل",
    replace: "رابط جديد",
    lastUsed: "آخر صورة",
    never: "لم يرسل بعد",
    failed: "حدث خطأ",
  },
}

export function WorkerLinksManager() {
  const { language } = useI18n()
  const text = TEXT[language === "ar" ? "ar" : "en"]
  const { toast } = useToast()
  const { data, mutate } = useSWR<{ links: WorkerLink[] } | null>("/api/maintenance/upload-links", fetcher)
  const [name, setName] = useState("")
  const [busy, setBusy] = useState<string | null>(null)
  const [shown, setShown] = useState<{ name: string; url: string } | null>(null)
  const [copied, setCopied] = useState(false)

  if (!data) return null
  const links = data.links

  const call = async (key: string, method: "POST" | "PATCH", body: Record<string, unknown>, label: string) => {
    setBusy(key)
    try {
      const response = await fetch("/api/maintenance/upload-links", {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      })
      const result = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(result?.error || text.failed)
      if (result.secret) {
        setShown({ name: label, url: `${window.location.origin}/m/${result.secret}` })
        setCopied(false)
      }
      await mutate()
      return true
    } catch (error: any) {
      toast({ title: text.failed, description: error?.message, variant: "destructive" })
      return false
    } finally {
      setBusy(null)
    }
  }

  const copy = async () => {
    if (!shown) return
    try {
      await navigator.clipboard.writeText(shown.url)
      setCopied(true)
    } catch {
      setCopied(false)
    }
  }

  return (
    <section aria-labelledby="worker-links-title" className="flex flex-col gap-3 border-t border-border pt-4">
      <div className="flex flex-col gap-1">
        <h3 id="worker-links-title" className="flex items-center gap-2 font-semibold">
          <Link2 className="size-4" aria-hidden="true" />
          {text.title}
        </h3>
        <p className="text-sm text-muted-foreground text-pretty">{text.hint}</p>
      </div>

      <form
        className="flex flex-col gap-2 sm:flex-row sm:items-end"
        onSubmit={async (e) => {
          e.preventDefault()
          const worker = name.trim()
          if (!worker) return
          if (await call("new", "POST", { workerName: worker }, worker)) setName("")
        }}
      >
        <div className="flex flex-1 flex-col gap-1">
          <Label htmlFor="worker-name">{text.name}</Label>
          <Input id="worker-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={80} className="min-h-11 text-base" />
        </div>
        <Button type="submit" className="min-h-11" disabled={!name.trim() || busy === "new"}>
          {busy === "new" && <Loader2 className="size-4 animate-spin" aria-hidden="true" />}
          {text.make}
        </Button>
      </form>

      {shown && (
        <div role="status" className="flex flex-col gap-2 rounded-md border border-primary bg-primary/5 p-3">
          <p className="text-sm text-pretty">{text.newLink(shown.name)}</p>
          <code className="break-all rounded bg-muted p-2 text-xs">{shown.url}</code>
          <Button variant="outline" size="sm" className="min-h-11 self-start" onClick={copy}>
            {copied ? <Check className="size-4" aria-hidden="true" /> : <Copy className="size-4" aria-hidden="true" />}
            {copied ? text.copied : text.copy}
          </Button>
        </div>
      )}

      {links.length > 0 && (
        <ul className="flex flex-col divide-y divide-border rounded-lg border border-border">
          {links.map((l) => (
            <li key={l.id} className="flex flex-wrap items-center justify-between gap-2 p-3">
              <div className="flex min-w-0 flex-col gap-1">
                <span className="flex items-center gap-2 font-medium">
                  {l.workerName}
                  <Badge variant={l.active ? "default" : "secondary"}>{l.active ? text.on : text.off}</Badge>
                </span>
                <span className="text-xs text-muted-foreground">
                  {text.lastUsed}: {l.lastUsedAt ? formatDate(l.lastUsedAt) : text.never}
                </span>
              </div>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  className="min-h-11"
                  disabled={busy === `t${l.id}`}
                  onClick={() => call(`t${l.id}`, "PATCH", { id: l.id, active: !l.active }, l.workerName)}
                >
                  {l.active ? text.turnOff : text.turnOn}
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className="min-h-11"
                  disabled={busy === `r${l.id}`}
                  onClick={() => call(`r${l.id}`, "POST", { id: l.id, action: "replace" }, l.workerName)}
                >
                  {text.replace}
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
