import { get } from "@vercel/blob"
import { createAdminClient } from "@/lib/supabase/admin"

// The draft's photo, from Blob storage (public store, unguessable address). Same access as the drafts (accountant, CEO, admin).
export const dynamic = "force-dynamic"

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const id = Number((await params).id)
  if (!Number.isInteger(id) || id <= 0) return new Response("Not found", { status: 404 })
  const { data: row } = await createAdminClient().from("maintenance_photo_drafts").select("photo_path, photo_type").eq("id", id).maybeSingle()
  if (!row) return new Response("Not found", { status: 404 })
  const file = await get(row.photo_path, { access: "public" })
  if (!file || file.statusCode !== 200 || !file.stream) return new Response("Not found", { status: 404 })
  return new Response(file.stream, {
    headers: {
      "Content-Type": row.photo_type,
      "Cache-Control": "private, max-age=600",
      "X-Content-Type-Options": "nosniff",
    },
  })
}
