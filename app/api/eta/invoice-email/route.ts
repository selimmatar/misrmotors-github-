import { createAdminClient } from "@/lib/supabase/admin"
import { NextResponse } from "next/server"
import { actorUserId } from "@/lib/auth/actor"
import { knownUserId } from "@/lib/po-history"
import { parsePositiveId } from "@/lib/parse-id"
import { readEtaSettings } from "@/lib/eta/store"
import { etaEnvironment } from "@/lib/eta/send"
import { invoiceEmailView, invoiceSignedFiles, sendInvoiceEmail } from "@/lib/eta/invoice-email"

export const dynamic = "force-dynamic"
export const maxDuration = 120

// The customer e-mail of a valid e-invoice (lib/eta/invoice-email.ts). Accountant, CEO, admin (the /api/eta rule).
// GET ?invoiceId=N: what the invoice shows (sent to / failed / no customer e-mail / not set up / database update needed).
// POST { invoiceId }: "Send by e-mail again" - sends the newest valid invoice document of the selected portal now, and
// logs it (trigger "manual"). Answers { status, email } (200 when sent; 409 / 502 with the reason otherwise).
// GET ?invoiceId=N&files=1: the signed delivery-permit uploads, to choose which go when a permit has several.
// POST may carry signedFileIds: only those uploads are attached (omitted: all of them).
export async function GET(request: Request) {
  const params = new URL(request.url).searchParams
  const invoiceId = parsePositiveId(params.get("invoiceId"))
  if (invoiceId === null) return NextResponse.json({ error: "invoiceId is required" }, { status: 400 })
  if (params.get("files") === "1") {
    try {
      return NextResponse.json({ permits: await invoiceSignedFiles(createAdminClient(), invoiceId) })
    } catch (error: any) {
      console.error("Error loading the signed permit files:", error)
      return NextResponse.json({ error: "Could not load the signed delivery permits" }, { status: 500 })
    }
  }
  return NextResponse.json(await invoiceEmailView(createAdminClient(), invoiceId))
}

/** The chosen uploads: a list of positive ids (at most 200); undefined when not given, null when not valid. */
function fileIds(raw: unknown): number[] | undefined | null {
  if (raw === undefined || raw === null) return undefined
  if (!Array.isArray(raw) || raw.length > 200) return null
  const ids = raw.map((v) => parsePositiveId(String(v)))
  return ids.every((n): n is number => n !== null) ? [...new Set(ids)] : null
}

const ANSWERS: Record<string, { status: number; error: string; errorAr: string }> = {
  not_valid: { status: 409, error: "This invoice has no valid e-invoice on the portal yet.", errorAr: "لا توجد فاتورة إلكترونية صالحة لهذه الفاتورة على البوابة بعد." },
  db_update_needed: { status: 409, error: "The database update for invoice e-mails has not been applied yet.", errorAr: "لم يتم تطبيق تحديث قاعدة البيانات الخاص بإرسال الفواتير بالبريد بعد." },
  not_configured: { status: 409, error: "E-mail is not set up (the e-mail settings are missing on the server).", errorAr: "البريد الإلكتروني غير مُعد (إعدادات البريد غير موجودة على الخادم)." },
  no_email: { status: 409, error: "The customer has no e-mail address. Add it on the customer card, then send again.", errorAr: "لا يوجد بريد إلكتروني للعميل. أضفه في بطاقة العميل ثم أعد الإرسال." },
  already: { status: 409, error: "This e-mail is being sent right now.", errorAr: "جارٍ إرسال هذا البريد الآن." },
}

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => null)
    const invoiceId = parsePositiveId(body && typeof body === "object" && (body as any).invoiceId != null ? String((body as any).invoiceId) : null)
    if (invoiceId === null) return NextResponse.json({ error: "invoiceId is required" }, { status: 400 })
    const signedFileIds = fileIds((body as any).signedFileIds)
    if (signedFileIds === null) return NextResponse.json({ error: "signedFileIds must be a list of file ids" }, { status: 400 })
    const db = createAdminClient()
    const environment = etaEnvironment(await readEtaSettings(db))
    const userId = await knownUserId(db, actorUserId(request))
    const result = await sendInvoiceEmail(db, invoiceId, { trigger: "manual", environment, userId, ...(signedFileIds ? { signedFileIds } : {}) })
    const email = await invoiceEmailView(db, invoiceId)
    if (result.status === "sent") return NextResponse.json({ status: "sent", to: result.to, email })
    if (result.status === "failed")
      return NextResponse.json({ status: "failed", code: "failed", error: result.error || "The e-mail could not be sent.", errorAr: "تعذر إرسال البريد الإلكتروني.", email }, { status: 502 })
    const a = ANSWERS[result.status]
    return NextResponse.json({ status: result.status, code: result.status, error: a.error, errorAr: a.errorAr, email }, { status: a.status })
  } catch (error: any) {
    console.error("Error sending the invoice e-mail:", error)
    return NextResponse.json({ error: "Failed to send the e-mail" }, { status: 500 })
  }
}
