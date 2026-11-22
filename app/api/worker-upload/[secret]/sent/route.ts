import { NextResponse } from "next/server"
import { createAdminClient } from "@/lib/supabase/admin"
import { hashSecret, isSecretShape } from "@/lib/maintenance-photos"
import { workerSentList } from "@/lib/worker-sent-list"
// The photos the worker sent through his link, newest first (owner, 2026-11-22). Public like the upload: the secret in
// the path is the key, checked exactly as the upload route does (shape, hash, active link). Read-only, his link only.
export const dynamic = "force-dynamic"

async function findLink(secret: string) {
  if (!isSecretShape(secret)) return null
  const { data } = await createAdminClient()
    .from("maintenance_upload_links")
    .select("id, active")
    .eq("secret_hash", hashSecret(secret))
    .maybeSingle()
  return data?.active ? Number(data.id) : null
}

export async function GET(_request: Request, { params }: { params: Promise<{ secret: string }> }) {
  const linkId = await findLink((await params).secret)
  if (!linkId) return NextResponse.json({ error: "inactive" }, { status: 404 })
  const db = createAdminClient()
  try {
    return NextResponse.json({ items: await workerSentList(db, linkId) }, { headers: { "Cache-Control": "no-store" } })
  } catch (error: any) {
    console.error("[worker-sent] failed:", error?.message || error)
    return NextResponse.json({ error: "failed" }, { status: 500 })
  }
}
