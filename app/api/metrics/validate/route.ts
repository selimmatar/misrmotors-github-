import { NextResponse } from "next/server"
import { validateMetrics } from "@/lib/metrics"

export const dynamic = "force-dynamic"

export async function GET() {
  try {
    const validationResults = await validateMetrics()

    const allValid = validationResults.every((r) => r.match)

    return NextResponse.json({
      success: true,
      allValid,
      results: validationResults,
      validatedAt: new Date().toISOString(),
    })
  } catch (error) {
    console.error("[Metrics Validation] Error:", error)
    return NextResponse.json({ success: false, error: "Failed to validate metrics" }, { status: 500 })
  }
}
