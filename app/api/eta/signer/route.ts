import { createAdminClient } from "@/lib/supabase/admin"
import { NextResponse } from "next/server"
import { actorUserId } from "@/lib/auth/actor"
import { knownUserId } from "@/lib/po-history"
import { pairSigner, revokeSigners, signerStatus } from "@/lib/eta/signer-auth"

export const dynamic = "force-dynamic"

const isTop = (request: Request) => {
  const roles = (request.headers.get("x-mm-roles") || "").split(",").map((r) => r.trim())
  return roles.includes("ceo") || roles.includes("admin")
}
const notTop = () => NextResponse.json({ error: "Only the CEO or an admin can connect or disconnect the signer", code: "FORBIDDEN" }, { status: 403 })

// GET: the signer's status (accountant, CEO, admin). Never returns the key or its hash.
export async function GET() {
  try {
    return NextResponse.json(await signerStatus(createAdminClient()))
  } catch (error: any) {
    console.error("Error reading the signer status:", error)
    return NextResponse.json({ error: "Failed to read the signer status" }, { status: 500 })
  }
}

// POST { name? }: "Connect a signer" (CEO / admin). Revokes the previous signer; the key is shown only in this answer.
export async function POST(request: Request) {
  try {
    if (!isTop(request)) return notTop()
    const db = createAdminClient()
    const body = await request.json().catch(() => ({}))
    const name = body && typeof body === "object" && typeof (body as any).name === "string" ? (body as any).name : ""
    const userId = await knownUserId(db, actorUserId(request))
    const paired = await pairSigner(db, name, userId)
    return NextResponse.json(paired, { headers: { "Cache-Control": "no-store" } })
  } catch (error: any) {
    console.error("Error pairing a signer:", error)
    return NextResponse.json({ error: "Failed to connect the signer" }, { status: 500 })
  }
}

// DELETE: "Disconnect" (CEO / admin). The key stops working at once.
export async function DELETE(request: Request) {
  try {
    if (!isTop(request)) return notTop()
    const revoked = await revokeSigners(createAdminClient())
    return NextResponse.json({ success: true, revoked })
  } catch (error: any) {
    console.error("Error disconnecting the signer:", error)
    return NextResponse.json({ error: "Failed to disconnect the signer" }, { status: 500 })
  }
}
