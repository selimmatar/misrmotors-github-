import { NextResponse, after } from "next/server"
import { put } from "@vercel/blob"
import { createAdminClient } from "@/lib/supabase/admin"
import {
  DAILY_PHOTO_LIMIT,
  MAX_PHOTO_BYTES,
  PHOTO_TYPES,
  hashSecret,
  isSecretShape,
  photoExtension,
  readDraftPhoto,
} from "@/lib/maintenance-photos"
import { attachPhotoToReservation, loadSharedStart, workerHoldsNumber } from "@/lib/shared-invoice-numbers"

// The maintenance worker's photo upload (spec 2026-11-19, Part 2). Public (no login): the secret in the path is the
// key, and it can only add a photo draft. lib/auth/permissions.ts PUBLIC_PREFIXES lets it through the middleware.
export const dynamic = "force-dynamic"
export const maxDuration = 120

const refuse = (status: number, code: string) => NextResponse.json({ error: code }, { status })

export async function POST(request: Request, { params }: { params: Promise<{ secret: string }> }) {
  const { secret } = await params
  if (!isSecretShape(secret)) return refuse(404, "inactive")

  const db = createAdminClient()
  const { data: link, error: linkError } = await db
    .from("maintenance_upload_links")
    .select("id, active")
    .eq("secret_hash", hashSecret(secret))
    .maybeSingle()
  if (linkError) {
    console.error("[worker-upload] link lookup:", linkError.message)
    return refuse(500, "failed")
  }
  if (!link || !link.active) return refuse(404, "inactive")

  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
  const { count } = await db
    .from("maintenance_photo_drafts")
    .select("id", { count: "exact", head: true })
    .eq("link_id", link.id)
    .gte("created_at", since)
  if ((count ?? 0) >= DAILY_PHOTO_LIMIT) return refuse(429, "limit")

  const form = await request.formData().catch(() => null)
  const photo = form?.get("photo")
  if (!(photo instanceof File) || photo.size === 0) return refuse(400, "no_photo")
  if (!PHOTO_TYPES.includes(photo.type)) return refuse(415, "not_photo")
  if (photo.size > MAX_PHOTO_BYTES) return refuse(413, "too_big")

  // With the shared numbering on, every photo belongs to the number the worker reserved before writing the page.
  const shared = await loadSharedStart(db).catch(() => null)
  if (shared && !(await workerHoldsNumber(db, link.id))) return refuse(409, "no_number")

  try {
    const bytes = Buffer.from(await photo.arrayBuffer())
    const blob = await put(`maintenance-photos/${link.id}/${Date.now()}.${photoExtension(photo.type)}`, bytes, {
      // The project's Blob store is public; the random suffix keeps the address unguessable, and the app only
      // shows the photo through the logged-in /api/maintenance/photo-drafts/[id]/photo route.
      access: "public",
      addRandomSuffix: true,
      contentType: photo.type,
    })
    const { data: draft, error } = await db
      .from("maintenance_photo_drafts")
      .insert({ link_id: link.id, photo_path: blob.pathname, photo_type: photo.type })
      .select("id")
      .single()
    if (error || !draft) throw new Error(error?.message || "draft not saved")
    let number: number | null = null
    if (shared) {
      number = await attachPhotoToReservation(db, link.id, draft.id)
      if (number) await db.from("maintenance_photo_drafts").update({ invoice_number: String(number) }).eq("id", draft.id)
    }
    await db.from("maintenance_upload_links").update({ last_used_at: new Date().toISOString() }).eq("id", link.id)

    // The worker gets "Received" at once; the reading continues after the answer is sent.
    const base64 = bytes.toString("base64")
    after(() => readDraftPhoto(db, draft.id, base64, photo.type))
    return NextResponse.json({ ok: true, number })
  } catch (error: any) {
    console.error("[worker-upload] failed:", error?.message || error)
    return refuse(500, "failed")
  }
}
