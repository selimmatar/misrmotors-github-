import { type NextRequest, NextResponse } from "next/server"
import { createAdminClient } from "@/lib/supabase/admin"
import { loadMissingItems } from "@/lib/missing-items"
import { renderMissingItemsHtml } from "@/lib/missing-items-html"
import { escapeHtml } from "@/lib/print-html"

export const dynamic = "force-dynamic"

function errorPage(title: string, message: string, status: number) {
  return new NextResponse(
    `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>${escapeHtml(title)}</title></head>
    <body style="font-family: Arial, sans-serif; padding: 60px; text-align: center; color: #333;">
      <h2 style="color: #dc2626;">${escapeHtml(title)}</h2>
      <p>${escapeHtml(message)}</p>
    </body></html>`,
    { status, headers: { "Content-Type": "text/html; charset=utf-8" } },
  )
}

// GET ?soId=<positive integer>[&hideCost=1]   hideCost: "1" or "true" hides Unit Cost and the cost total; anything else shows them
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const soIdParam = searchParams.get("soId")
    if (!soIdParam || !/^\d{1,9}$/.test(soIdParam) || Number(soIdParam) < 1) {
      return errorPage("Missing Sales Order ID", "Please provide a valid sales order ID (soId).", 400)
    }
    const soId = Number(soIdParam)
    const hideCost = ["1", "true"].includes((searchParams.get("hideCost") || "").toLowerCase())

    const report = await loadMissingItems(createAdminClient(), soId)
    if (!report) return errorPage("Sales Order Not Found", `No sales order found for ID ${soId}.`, 404)

    const generatedAt = new Date().toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" })
    return new NextResponse(renderMissingItemsHtml(report, { hideCost, generatedAt }), { headers: { "Content-Type": "text/html; charset=utf-8" } })
  } catch (error) {
    console.error("Missing items report error:", error)
    return errorPage("Failed to Generate Report", "An unexpected error occurred while generating the missing items report.", 500)
  }
}
