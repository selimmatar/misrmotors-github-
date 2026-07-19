import { NextResponse } from "next/server"
import { WebhookService } from "@/lib/webhook-service"

export const dynamic = "force-dynamic"

export async function GET() {
  try {
    const webhookService = WebhookService.getInstance()
    const webhooks = webhookService.getWebhooks()
    return NextResponse.json(webhooks)
  } catch (error) {
    console.error("Webhooks GET: Error", error)
    return NextResponse.json({ error: "Failed to fetch webhooks" }, { status: 500 })
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json()
    const webhookService = WebhookService.getInstance()
    const webhook = webhookService.addWebhook(body)
    return NextResponse.json(webhook)
  } catch (error) {
    console.error("Webhooks POST: Error", error)
    return NextResponse.json({ error: "Failed to create webhook" }, { status: 500 })
  }
}

export async function PUT(request: Request) {
  try {
    const body = await request.json()
    const { id, ...updates } = body
    const webhookService = WebhookService.getInstance()
    webhookService.updateWebhook(id, updates)
    return NextResponse.json({ success: true })
  } catch (error) {
    console.error("Webhooks PUT: Error", error)
    return NextResponse.json({ error: "Failed to update webhook" }, { status: 500 })
  }
}

export async function DELETE(request: Request) {
  try {
    const { searchParams } = new URL(request.url)
    const id = searchParams.get("id")
    if (!id) {
      return NextResponse.json({ error: "Webhook ID required" }, { status: 400 })
    }
    const webhookService = WebhookService.getInstance()
    webhookService.deleteWebhook(id)
    return NextResponse.json({ success: true })
  } catch (error) {
    console.error("Webhooks DELETE: Error", error)
    return NextResponse.json({ error: "Failed to delete webhook" }, { status: 500 })
  }
}
