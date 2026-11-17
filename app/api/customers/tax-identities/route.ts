import { createAdminClient } from "@/lib/supabase/admin"
import { NextResponse } from "next/server"
import { parsePositiveId } from "@/lib/parse-id"
import { addIdentity, loadCustomerIdentities, updateIdentity } from "@/lib/eta/identities"

export const dynamic = "force-dynamic"

// A customer's tax identities (each sister company / branch with its own name, tax number and address), under the
// /api/customers rule: everyone signed in reads, sales reps and accountants (plus CEO / admin) add and change.
// A bad tax number / national ID is saved as typed and reported in `warnings` (as on the customer card).

// GET ?customerId=N: all of the customer's identities, switched-off ones too (oldest first).
export async function GET(request: Request) {
  try {
    const customerId = parsePositiveId(new URL(request.url).searchParams.get("customerId"))
    if (customerId === null) return NextResponse.json({ error: "customerId is required" }, { status: 400 })
    return NextResponse.json(await loadCustomerIdentities(createAdminClient(), customerId))
  } catch (error) {
    console.error("Error loading tax identities:", error)
    return NextResponse.json({ error: "Failed to load the tax identities" }, { status: 500 })
  }
}

const readBody = async (request: Request) => {
  const body = await request.json().catch(() => null)
  return body && typeof body === "object" && !Array.isArray(body) ? body : null
}

// POST { customerId, name, receiverType?, taxRegistrationNumber?, nationalId?, governorate?, region?, street?, buildingNumber? }
export async function POST(request: Request) {
  try {
    const body = await readBody(request)
    if (!body) return NextResponse.json({ error: "Invalid body" }, { status: 400 })
    const customerId = parsePositiveId(body.customerId == null ? null : String(body.customerId))
    if (customerId === null) return NextResponse.json({ error: "customerId is required" }, { status: 400 })
    const r = await addIdentity(createAdminClient(), customerId, body)
    if (!r.ok) return NextResponse.json({ error: r.error, code: r.code }, { status: r.status })
    return NextResponse.json(r.warnings.length ? { ...r.value, warnings: r.warnings } : r.value)
  } catch (error) {
    console.error("Error adding a tax identity:", error)
    return NextResponse.json({ error: "Failed to save the tax identity" }, { status: 500 })
  }
}

// PUT { customerId, identityId, ...fields present, active? }: edit, or switch off / on (active false / true).
export async function PUT(request: Request) {
  try {
    const body = await readBody(request)
    if (!body) return NextResponse.json({ error: "Invalid body" }, { status: 400 })
    const customerId = parsePositiveId(body.customerId == null ? null : String(body.customerId))
    const identityId = parsePositiveId(body.identityId == null ? null : String(body.identityId))
    if (customerId === null || identityId === null) return NextResponse.json({ error: "customerId and identityId are required" }, { status: 400 })
    if (body.active !== undefined && typeof body.active !== "boolean") return NextResponse.json({ error: "active must be true or false" }, { status: 400 })
    const r = await updateIdentity(createAdminClient(), customerId, identityId, body)
    if (!r.ok) return NextResponse.json({ error: r.error, code: r.code }, { status: r.status })
    return NextResponse.json(r.warnings.length ? { ...r.value, warnings: r.warnings } : r.value)
  } catch (error) {
    console.error("Error updating a tax identity:", error)
    return NextResponse.json({ error: "Failed to save the tax identity" }, { status: 500 })
  }
}
