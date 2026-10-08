import { NextResponse } from "next/server"

export const dynamic = "force-dynamic"

// Retired (Batch 4F): this route used the wrong columns and is not called by the UI. Returns go through /api/returns.
// Every method answers 410 without touching the database.
const retired = () => NextResponse.json({ code: "ENDPOINT_RETIRED", error: "Use /api/returns" }, { status: 410 })

export async function GET() {
  return retired()
}
export async function POST() {
  return retired()
}
export async function PUT() {
  return retired()
}
export async function PATCH() {
  return retired()
}
export async function DELETE() {
  return retired()
}
