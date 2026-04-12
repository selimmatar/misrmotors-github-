import { NextResponse } from "next/server"
import { WebhookService } from "@/lib/webhook-service"

// API endpoint for n8n to receive data from external sources
export async function POST(request: Request) {
  try {
    const body = await request.json()
    const { event, data } = body

    if (!event || !data) {
      return NextResponse.json({ error: "Event and data are required" }, { status: 400 })
    }

    console.log("[v0] Incoming webhook trigger:", event)

    // Process the incoming webhook data
    // You can add custom logic here to handle different events
    
    return NextResponse.json({ success: true, received: true })
  } catch (error) {
    console.error("[v0] Webhook trigger error:", error)
    return NextResponse.json({ error: "Failed to process webhook" }, { status: 500 })
  }
}
