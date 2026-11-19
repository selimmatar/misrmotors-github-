import { NextResponse } from "next/server"
import { createAdminClient } from "@/lib/supabase/admin"
import { actorUserId } from "@/lib/auth/actor"
import { MAX_WORKER_NAME, hashSecret, newSecret } from "@/lib/maintenance-photos"

// The maintenance workers' personal photo links (spec 2026-11-19, Part 2). Who may: admin and CEO only.
// Only the secret's hash is stored, so the link is shown once: when it is made or replaced.
export const dynamic = "force-dynamic"

const answer = (status: number, error: string) => NextResponse.json({ error }, { status })

export async function GET() {
  const { data, error } = await createAdminClient()
    .from("maintenance_upload_links")
    .select("id, worker_name, active, created_at, last_used_at")
    .order("created_at", { ascending: false })
  if (error) return answer(500, "Could not load the links")
  return NextResponse.json({
    links: (data || []).map((l: any) => ({
      id: l.id,
      workerName: l.worker_name,
      active: l.active,
      createdAt: l.created_at,
      lastUsedAt: l.last_used_at,
    })),
  })
}

/** { workerName } makes a new link; { id, action: "replace" } gives an existing worker a new link (the old one stops). */
export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as Record<string, any> | null
  const db = createAdminClient()
  const secret = newSecret()

  if (body?.action === "replace") {
    const id = Number(body.id)
    if (!Number.isInteger(id) || id <= 0) return answer(400, "Missing link")
    const { data, error } = await db
      .from("maintenance_upload_links")
      .update({ secret_hash: hashSecret(secret), active: true })
      .eq("id", id)
      .select("id")
    if (error) return answer(500, "Could not replace the link")
    if (!data?.length) return answer(404, "Link not found")
    return NextResponse.json({ secret })
  }

  const workerName = String(body?.workerName ?? "").trim().slice(0, MAX_WORKER_NAME)
  if (!workerName) return answer(400, "Enter the worker's name")
  const { error } = await db
    .from("maintenance_upload_links")
    .insert({ worker_name: workerName, secret_hash: hashSecret(secret), created_by: actorUserId(request) })
  if (error) return answer(500, "Could not make the link")
  return NextResponse.json({ secret })
}

/** { id, active } switches a link off or on. */
export async function PATCH(request: Request) {
  const body = (await request.json().catch(() => null)) as Record<string, any> | null
  const id = Number(body?.id)
  if (!Number.isInteger(id) || id <= 0 || typeof body?.active !== "boolean") return answer(400, "Missing details")
  const { data, error } = await createAdminClient().from("maintenance_upload_links").update({ active: body.active }).eq("id", id).select("id")
  if (error) return answer(500, "Could not change the link")
  if (!data?.length) return answer(404, "Link not found")
  return NextResponse.json({ ok: true })
}
