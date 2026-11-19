import { NextResponse } from "next/server"
import { createAdminClient } from "@/lib/supabase/admin"

// Photo drafts waiting for the accountant (spec 2026-11-19, Part 2). Who may: accountant, CEO, admin (permissions.ts).
export const dynamic = "force-dynamic"

export async function GET() {
  const { data, error } = await createAdminClient()
    .from("maintenance_photo_drafts")
    .select("id, created_at, status, read_status, read_data, link:maintenance_upload_links(worker_name)")
    .in("status", ["waiting", "converting"])
    .order("created_at", { ascending: false })
    .limit(100)
  if (error) {
    console.error("[photo-drafts] list:", error.message)
    return NextResponse.json({ error: "Could not load the photos" }, { status: 500 })
  }
  return NextResponse.json({
    drafts: (data || []).map((d: any) => ({
      id: d.id,
      createdAt: d.created_at,
      status: d.status,
      readStatus: d.read_status,
      read: d.read_data,
      workerName: d.link?.worker_name || "",
    })),
  })
}
