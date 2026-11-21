import { NextResponse } from "next/server"
import { createAdminClient } from "@/lib/supabase/admin"
import { actorUserId } from "@/lib/auth/actor"
import { officeNumbersView, officeReleaseReservation, setSharedStart } from "@/lib/shared-invoice-numbers"

// The accountant's view of the one shared invoice sequence (sales + maintenance booklet), owner 2026-11-21.
export const dynamic = "force-dynamic"

const answer = (status: number, error: string) => NextResponse.json({ error }, { status })

export async function GET() {
  try {
    return NextResponse.json(await officeNumbersView(createAdminClient()))
  } catch (error: any) {
    console.error("[shared-numbers] view:", error?.message || error)
    return answer(500, "Could not load the invoice numbers")
  }
}

/** { start } sets the starting number once, before any number is handed out. */
export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as Record<string, any> | null
  const start = Number(String(body?.start ?? "").trim())
  const result = await setSharedStart(createAdminClient(), start, actorUserId(request))
  if (!result.ok) return answer(400, result.error)
  return NextResponse.json({ ok: true })
}

/** { number } cancels a number a worker held and never photographed. */
export async function PATCH(request: Request) {
  const body = (await request.json().catch(() => null)) as Record<string, any> | null
  const number = Number(body?.number)
  if (!Number.isInteger(number) || number <= 0) return answer(400, "Missing number")
  const done = await officeReleaseReservation(createAdminClient(), number)
  if (!done) return answer(409, `${number} is no longer held by a worker`)
  return NextResponse.json({ ok: true })
}
