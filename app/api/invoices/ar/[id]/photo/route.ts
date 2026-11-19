import { get } from "@vercel/blob"
import { createAdminClient } from "@/lib/supabase/admin"

// The photographed MINV page an invoice was made from. Lives under /api/invoices/ar so it has the same access as the
// invoice itself (anyone who can see receivables), not the accountant-only photo-drafts review.
export const dynamic = "force-dynamic"

function notFound() {
  return new Response("No photo is stored for this invoice.", {
    status: 404,
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  })
}

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const id = Number((await params).id)
  if (!Number.isInteger(id) || id <= 0) return notFound()
  const { data: row } = await createAdminClient()
    .from("maintenance_photo_drafts")
    .select("photo_path, photo_type")
    .eq("invoice_id", id)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle()
  if (!row?.photo_path) return notFound()
  const file = await get(row.photo_path, { access: "public" })
  if (!file || file.statusCode !== 200 || !file.stream) return notFound()
  return new Response(file.stream, {
    headers: {
      "Content-Type": row.photo_type,
      "Cache-Control": "private, max-age=600",
      "X-Content-Type-Options": "nosniff",
    },
  })
}
