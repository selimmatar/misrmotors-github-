import { createAdminClient } from "@/lib/supabase/admin"
import { NextResponse } from "next/server"
import { actorUserId } from "@/lib/auth/actor"
import { parsePositiveId } from "@/lib/parse-id"
import { readEtaSettings } from "@/lib/eta/store"
import { etaEnvironment } from "@/lib/eta/send"
import { credentialsSet, EtaCredentialsError, EtaError } from "@/lib/eta/portal"
import { fillAddressFromPortal, type AddressRequest, type AddressStatus } from "@/lib/eta/receiver-address"

export const dynamic = "force-dynamic"
export const maxDuration = 60

const MESSAGES: Record<AddressStatus, { en: string; ar: string; http: number }> = {
  filled: { en: "Address found on the portal and saved.", ar: "تم العثور على العنوان في البوابة وحفظه.", http: 200 },
  complete: { en: "The address is already filled in.", ar: "العنوان مكتوب بالفعل.", http: 200 },
  not_found: { en: "Not found on the portal - please type the address.", ar: "لم يتم العثور عليه في البوابة - من فضلك اكتب العنوان.", http: 200 },
  not_found_cached: { en: "Not found on the portal - please type the address.", ar: "لم يتم العثور عليه في البوابة - من فضلك اكتب العنوان.", http: 200 },
  busy: { en: "The portal is busy right now. Try again in a minute.", ar: "البوابة مشغولة الآن. حاول مرة أخرى بعد دقيقة.", http: 429 },
  incomplete_search: { en: "The portal search took too long. Try again.", ar: "استغرق البحث في البوابة وقتًا طويلًا. حاول مرة أخرى.", http: 200 },
  choose_identity: { en: "Choose which company this invoice is for first.", ar: "اختر أولًا الشركة التي تصدر لها هذه الفاتورة.", http: 409 },
  no_tax_number: { en: "A 9-digit tax number is needed to search the portal.", ar: "يلزم رقم ضريبي من 9 أرقام للبحث في البوابة.", http: 400 },
  not_found_record: { en: "Not found.", ar: "غير موجود.", http: 404 },
}

// POST { invoiceId } | { customerId, identityId? }, auto?: the receiver's missing address from an earlier portal
// document of its tax number (read-only toward the portal); only empty fields are filled. `auto` (the preview opening)
// skips a tax number searched without luck in the last day. Accountant, CEO, admin (the /api/eta rule).
// -> { status, message, messageAr, filled?, sourceUuid?, source? }
export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => null)
    if (!body || typeof body !== "object" || Array.isArray(body)) return NextResponse.json({ error: "Invalid body" }, { status: 400 })
    let req: AddressRequest
    if (body.invoiceId != null) {
      const invoiceId = parsePositiveId(String(body.invoiceId))
      if (invoiceId === null) return NextResponse.json({ error: "Invalid invoiceId" }, { status: 400 })
      req = { invoiceId }
    } else {
      const customerId = parsePositiveId(body.customerId == null ? null : String(body.customerId))
      if (customerId === null) return NextResponse.json({ error: "invoiceId or customerId is required" }, { status: 400 })
      const identityId = body.identityId == null ? null : parsePositiveId(String(body.identityId))
      if (body.identityId != null && identityId === null) return NextResponse.json({ error: "Invalid identityId" }, { status: 400 })
      req = { customerId, identityId }
    }
    const db = createAdminClient()
    const env = etaEnvironment(await readEtaSettings(db))
    if (!credentialsSet(env)) return NextResponse.json({ error: new EtaCredentialsError(env).message, code: "CredentialsMissing" }, { status: 400 })
    const r = await fillAddressFromPortal(db, env, req, { userId: actorUserId(request), useMissCache: body.auto === true })
    const m = MESSAGES[r.status]
    const out = { status: r.status, message: m.en, messageAr: m.ar, environment: env, filled: r.filled, sourceUuid: r.sourceUuid, source: r.source, address: r.address }
    return NextResponse.json(m.http === 200 ? out : { ...out, error: m.en, errorAr: m.ar }, { status: m.http })
  } catch (error: any) {
    if (error instanceof EtaError) return NextResponse.json({ error: error.message, code: error.code }, { status: error.code === "Timeout" ? 504 : 502 })
    console.error("Error reading the receiver address from the portal:", error)
    return NextResponse.json({ error: "Could not read the address from the portal. Nothing was changed on the portal." }, { status: 500 })
  }
}
