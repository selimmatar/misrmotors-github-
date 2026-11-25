import { createAdminClient } from "@/lib/supabase/admin"
import { NextResponse } from "next/server"
import { actorUserId } from "@/lib/auth/actor"
import { knownUserId } from "@/lib/po-history"
import { parsePositiveId } from "@/lib/parse-id"
import { DOC_KINDS, docEmailView, sendDocEmail, type DocKind } from "@/lib/email/document-email"

export const dynamic = "force-dynamic"
// making the PDF starts a headless browser
export const maxDuration = 60

// "Send to customer" for a quotation or a sales order (lib/email/document-email.ts). Read: everyone; send: sales
// (the /api/document-email rule). Manual only.
// GET ?kind=quotation|sales-order&id=N: the Send window (suggested addresses, earlier sends).
// POST { kind, id, to: "a@x.com, b@y.com" }: sends the document as a PDF to those addresses now, and logs it.
const kindOf = (v: unknown): DocKind | null => (DOC_KINDS.includes(v as DocKind) ? (v as DocKind) : null)

export async function GET(request: Request) {
  const q = new URL(request.url).searchParams
  const kind = kindOf(q.get("kind"))
  const id = parsePositiveId(q.get("id"))
  if (!kind || id === null) return NextResponse.json({ error: "kind and id are required" }, { status: 400 })
  try {
    const view = await docEmailView(createAdminClient(), kind, id)
    if (!view) return NextResponse.json({ error: "Not found" }, { status: 404 })
    return NextResponse.json(view)
  } catch (error) {
    console.error("Reading the send window failed:", error)
    return NextResponse.json({ error: "Could not read the document" }, { status: 500 })
  }
}

const ANSWERS: Record<string, { status: number; error: string; errorAr: string }> = {
  not_found: { status: 404, error: "This document was not found.", errorAr: "المستند غير موجود." },
  db_update_needed: { status: 409, error: "The database update for sending to customers has not been applied yet.", errorAr: "لم يتم تطبيق تحديث قاعدة البيانات الخاص بالإرسال للعملاء بعد." },
  not_configured: { status: 409, error: "E-mail is not set up (the e-mail settings are missing on the server).", errorAr: "البريد الإلكتروني غير مُعد (إعدادات البريد غير موجودة على الخادم)." },
  no_email: { status: 409, error: "Enter at least one valid e-mail address.", errorAr: "أدخل عنوان بريد إلكتروني صحيحًا واحدًا على الأقل." },
}

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => null)
    if (!body || typeof body !== "object") return NextResponse.json({ error: "Invalid body" }, { status: 400 })
    const kind = kindOf((body as any).kind)
    const id = parsePositiveId((body as any).id == null ? null : String((body as any).id))
    if (!kind || id === null) return NextResponse.json({ error: "kind and id are required" }, { status: 400 })
    const db = createAdminClient()
    const userId = await knownUserId(db, actorUserId(request))
    const result = await sendDocEmail(db, kind, id, { to: (body as any).to, userId })
    const email = await docEmailView(db, kind, id).catch(() => null)
    if (result.status === "sent") return NextResponse.json({ status: "sent", to: result.to, email })
    if (result.status === "failed")
      return NextResponse.json({ status: "failed", code: "failed", error: result.error || "The e-mail could not be sent.", errorAr: "تعذر إرسال البريد الإلكتروني.", email }, { status: 502 })
    const a = ANSWERS[result.status]
    return NextResponse.json({ status: result.status, code: result.status, error: a.error, errorAr: a.errorAr, email }, { status: a.status })
  } catch (error) {
    console.error("Sending the document e-mail failed:", error)
    return NextResponse.json({ error: "Failed to send the e-mail" }, { status: 500 })
  }
}
