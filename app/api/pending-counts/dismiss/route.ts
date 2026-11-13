// POST { key, hide } -> hide a "Waiting for you" suggestion (hide: true) or show it again (hide: false).
// See lib/notifications/dismissed.ts. Purchasing staff, the CEO and admins (lib/auth/permissions.ts).
import { NextResponse } from "next/server"
import { createAdminClient } from "@/lib/supabase/admin"
import { DISMISS_EVENT, isSuggestionKey, keyEntityId } from "@/lib/notifications/dismissed"
import { knownUserId } from "@/lib/po-history"
import { actorUserId } from "@/lib/auth/actor"

export const dynamic = "force-dynamic"

export async function POST(request: Request) {
  let body: any
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 })
  }
  const key = body?.key
  if (!isSuggestionKey(key) || typeof body?.hide !== "boolean") return NextResponse.json({ error: "Choose a suggestion" }, { status: 400 })
  try {
    const db = createAdminClient()
    const { error: clearError } = await db.from("workflow_events").delete().eq("entity_type", "SUGGESTION").eq("event_type", DISMISS_EVENT).eq("new_value", key)
    if (clearError) throw clearError
    if (body.hide) {
      const { error } = await db.from("workflow_events").insert({
        entity_type: "SUGGESTION",
        entity_id: keyEntityId(key),
        event_type: DISMISS_EVENT,
        new_value: key,
        performed_by: await knownUserId(db, actorUserId(request, body?.userId)),
        metadata: {},
      })
      if (error) throw error
    }
    return NextResponse.json({ ok: true, hidden: body.hide })
  } catch (error) {
    console.error("hide suggestion error:", error)
    return NextResponse.json({ error: "Could not save" }, { status: 500 })
  }
}
