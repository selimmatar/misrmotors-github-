import { createAdminClient } from "@/lib/supabase/admin"
import { NextResponse } from "next/server"
import { actorUserId } from "@/lib/auth/actor"
import { knownUserId } from "@/lib/po-history"
import { parsePositiveId } from "@/lib/parse-id"
import { buildEtaPreview } from "@/lib/eta/preview"
import { readEtaSettings } from "@/lib/eta/store"
import { etaEnvironment, followUpQuietly } from "@/lib/eta/send"
import { cancelWindowHours, invoiceDocuments } from "@/lib/eta/after-send"

export const dynamic = "force-dynamic"

// GET ?invoiceId=N: the e-invoice preview of one customer invoice, plus its portal documents per environment
// (`documents`), the selected portal (`environment`) and that portal's cancel window (`cancelWindowHours`, null when
// unknown or nothing there is valid). The throttled, time-boxed follow-up runs first, so opening the invoice refreshes
// the status of whatever is waiting on the portal.
export async function GET(request: Request) {
  try {
    const invoiceId = parsePositiveId(new URL(request.url).searchParams.get("invoiceId"))
    if (invoiceId === null) return NextResponse.json({ error: "invoiceId is required" }, { status: 400 })
    const db = createAdminClient()
    await followUpQuietly(db)
    const preview = await buildEtaPreview(db, invoiceId)
    if (!preview) return NextResponse.json({ error: "Invoice not found" }, { status: 404 })
    const environment = etaEnvironment(await readEtaSettings(db))
    const documents = await invoiceDocuments(db, invoiceId)
    const windowHours = documents[environment].some((d) => d.status === "valid") ? await cancelWindowHours(environment) : null
    return NextResponse.json({ ...preview, environment, documents, cancelWindowHours: windowHours })
  } catch (error: any) {
    console.error("Error building the e-invoice preview:", error)
    return NextResponse.json({ error: error.message || "Failed to build the e-invoice preview" }, { status: 500 })
  }
}

// POST { invoiceId, etaUuid? }: mark the invoice "already on the portal" (eta_documents status "manual"). A document
// in any other status (sent by step 2) is never overwritten.
export async function POST(request: Request) {
  try {
    const db = createAdminClient()
    const body = await request.json().catch(() => null)
    if (!body || typeof body !== "object") return NextResponse.json({ error: "Invalid body" }, { status: 400 })
    const invoiceId = parsePositiveId(body.invoiceId == null ? null : String(body.invoiceId))
    if (invoiceId === null) return NextResponse.json({ error: "invoiceId is required" }, { status: 400 })
    if (body.etaUuid != null && typeof body.etaUuid !== "string") return NextResponse.json({ error: "etaUuid must be text" }, { status: 400 })
    const etaUuid = typeof body.etaUuid === "string" ? body.etaUuid.trim() : ""
    if (etaUuid.length > 100) return NextResponse.json({ error: "etaUuid is too long" }, { status: 400 })

    const { data: invoice, error: invErr } = await db.from("accounts_receivable").select("invoice_id").eq("invoice_id", invoiceId).maybeSingle()
    if (invErr) throw invErr
    if (!invoice) return NextResponse.json({ error: "Invoice not found" }, { status: 404 })

    // the invoice's real-portal invoice documents (test sends and credit notes don't count; several rows may exist)
    const { data: docs, error: docErr } = await db.from("eta_documents").select("doc_id, status, document_type, environment").eq("invoice_id", invoiceId)
    if (docErr) throw docErr
    const real = ((docs || []) as any[]).filter((d) => (d.environment || "real") === "real" && (d.document_type || "I") === "I")
    const existing = real.find((d) => d.status !== "manual") || real[0] || null
    const notManual = () => NextResponse.json({ error: "This invoice already has an e-invoice document; it cannot be marked as handled manually." }, { status: 409 })
    if (existing && existing.status !== "manual") return notManual()

    const now = new Date().toISOString()
    if (!existing) {
      const userId = await knownUserId(db, actorUserId(request))
      const { error } = await db
        .from("eta_documents")
        .insert({ invoice_id: invoiceId, document_type: "I", status: "manual", eta_uuid: etaUuid || null, created_by: userId, created_at: now, updated_at: now })
      // invoice_id is unique: another request created the document first
      if (error?.code === "23505") return notManual()
      if (error) throw error
    } else {
      // only a manual mark is changed; the ID is kept when none is given
      const { data: updated, error } = await db
        .from("eta_documents")
        .update({ ...(etaUuid ? { eta_uuid: etaUuid } : {}), updated_at: now })
        .eq("invoice_id", invoiceId)
        .eq("status", "manual")
        .select("doc_id")
      if (error) throw error
      if (!updated || updated.length === 0) return notManual()
    }
    return NextResponse.json({ success: true })
  } catch (error: any) {
    console.error("Error marking the invoice as handled manually:", error)
    return NextResponse.json({ error: error.message || "Failed to save" }, { status: 500 })
  }
}

// DELETE ?invoiceId=N: remove the "already on the portal" mark. Only a "manual" document is removed.
export async function DELETE(request: Request) {
  try {
    const invoiceId = parsePositiveId(new URL(request.url).searchParams.get("invoiceId"))
    if (invoiceId === null) return NextResponse.json({ error: "invoiceId is required" }, { status: 400 })
    const { data, error } = await createAdminClient().from("eta_documents").delete().eq("invoice_id", invoiceId).eq("status", "manual").select("doc_id")
    if (error) throw error
    if (!data || data.length === 0) return NextResponse.json({ error: "This invoice is not marked as handled manually" }, { status: 404 })
    return NextResponse.json({ success: true })
  } catch (error: any) {
    console.error("Error removing the manual mark:", error)
    return NextResponse.json({ error: error.message || "Failed to remove" }, { status: 500 })
  }
}
