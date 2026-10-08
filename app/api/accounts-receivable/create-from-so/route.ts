import { NextResponse } from "next/server"

// RETIRED. Invoices are created strictly per delivery permit, and only from APPROVED permits
// (POST /api/accounts-receivable/create-from-dps). Nothing is created or read here.
export async function POST() {
  return NextResponse.json(
    {
      error: "Creating an invoice directly from a sales order is no longer supported. Invoices are created from approved delivery permits.",
      code: "CREATE_FROM_SO_RETIRED",
    },
    { status: 410 },
  )
}
