import { NextResponse } from "next/server"
import { createAdminClient } from "@/lib/supabase/admin"
import { hashSecret, isSecretShape } from "@/lib/maintenance-photos"
import { workerNumberAction, workerNumberState, type WorkerAction } from "@/lib/shared-invoice-numbers"

// The worker reserves the number of the booklet page he is about to write, cancels it (spoiled page) or takes it back.
// Public like the upload: the secret in the path is the key (lib/auth/permissions.ts PUBLIC_PREFIXES).
export const dynamic = "force-dynamic"

const ACTIONS: WorkerAction[] = ["take", "cancel", "undo"]

async function findLink(secret: string) {
  if (!isSecretShape(secret)) return null
  const { data } = await createAdminClient()
    .from("maintenance_upload_links")
    .select("id, active")
    .eq("secret_hash", hashSecret(secret))
    .maybeSingle()
  return data?.active ? Number(data.id) : null
}

export async function POST(request: Request, { params }: { params: Promise<{ secret: string }> }) {
  const linkId = await findLink((await params).secret)
  if (!linkId) return NextResponse.json({ error: "inactive" }, { status: 404 })
  const body = (await request.json().catch(() => null)) as { action?: string } | null
  const action = body?.action as WorkerAction
  if (!ACTIONS.includes(action)) return NextResponse.json({ error: "failed" }, { status: 400 })
  const db = createAdminClient()
  try {
    const done = await workerNumberAction(db, linkId, action)
    const state = await workerNumberState(db, linkId)
    if (!done.ok) return NextResponse.json({ error: done.code, state }, { status: 409 })
    return NextResponse.json({ ok: true, state })
  } catch (error: any) {
    console.error("[worker-number] failed:", error?.message || error)
    return NextResponse.json({ error: "failed" }, { status: 500 })
  }
}
