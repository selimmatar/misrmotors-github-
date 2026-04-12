import type { WebhookConfig, WebhookPayload } from "./types"

// Webhook service for triggering n8n workflows
export class WebhookService {
  private static instance: WebhookService
  private webhooks: WebhookConfig[] = []

  private constructor() {
    // Load webhooks from localStorage or database
    if (typeof window !== "undefined") {
      const stored = localStorage.getItem("webhooks")
      if (stored) {
        this.webhooks = JSON.parse(stored)
      }
    }
  }

  static getInstance(): WebhookService {
    if (!WebhookService.instance) {
      WebhookService.instance = new WebhookService()
    }
    return WebhookService.instance
  }

  private getEnvWebhooks(event: WebhookPayload["event"]): string[] {
    const envWebhooks: string[] = []

    // Check for event-specific webhook URLs from environment variables
    const eventEnvMap: Record<string, string | undefined> = {
      "sales_order.created": process.env.N8N_SALES_ORDER_CREATED_WEBHOOK_URL || process.env.N8N_SALES_ORDER_WEBHOOK_URL,
      "sales_order.approved":
        process.env.N8N_SALES_ORDER_APPROVED_WEBHOOK_URL || process.env.N8N_SALES_ORDER_WEBHOOK_URL,
      "purchase_order.created": process.env.N8N_PURCHASE_ORDER_WEBHOOK_URL,
      "purchase_order.approved": process.env.N8N_PURCHASE_ORDER_WEBHOOK_URL,
      "payment.reminder": process.env.N8N_PAYMENT_REMINDER_WEBHOOK_URL,
      "inventory.low_stock": process.env.N8N_INVENTORY_WEBHOOK_URL,
    }

    const webhookUrl = eventEnvMap[event]
    if (webhookUrl) {
      envWebhooks.push(webhookUrl)
    }

    // Also check for a general webhook URL
    const generalWebhook = process.env.N8N_WEBHOOK_URL
    if (generalWebhook && !envWebhooks.includes(generalWebhook)) {
      envWebhooks.push(generalWebhook)
    }

    return envWebhooks
  }

  async trigger(event: WebhookPayload["event"], data: any): Promise<void> {
    const activeWebhooks = this.webhooks.filter((wh) => wh.enabled && wh.event === event)
    const envWebhookUrls = this.getEnvWebhooks(event)

    const totalWebhooks = activeWebhooks.length + envWebhookUrls.length
    console.log(`[v0] Webhook: Triggering ${event} for ${totalWebhooks} webhook(s)`)

    if (totalWebhooks === 0) {
      console.log(`[v0] Webhook: No webhooks configured for ${event}`)
      return
    }

    const payload: WebhookPayload = {
      event,
      timestamp: new Date().toISOString(),
      data,
    }

    const localPromises = activeWebhooks.map(async (webhook) => {
      try {
        const response = await fetch(webhook.url, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...webhook.headers,
          },
          body: JSON.stringify(payload),
        })

        if (!response.ok) {
          console.error(`[v0] Webhook ${webhook.name} failed:`, response.statusText)
        } else {
          console.log(`[v0] Webhook ${webhook.name} triggered successfully`)
        }
      } catch (error) {
        console.error(`[v0] Webhook ${webhook.name} error:`, error)
      }
    })

    const envPromises = envWebhookUrls.map(async (url) => {
      try {
        console.log(`[v0] Webhook: Calling env webhook ${url.substring(0, 50)}...`)
        const response = await fetch(url, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify(payload),
        })

        if (!response.ok) {
          console.error(`[v0] Env webhook failed:`, response.statusText)
        } else {
          console.log(`[v0] Env webhook triggered successfully for ${event}`)
        }
      } catch (error) {
        console.error(`[v0] Env webhook error:`, error)
      }
    })

    await Promise.allSettled([...localPromises, ...envPromises])
  }

  addWebhook(webhook: Omit<WebhookConfig, "id" | "createdAt">): WebhookConfig {
    const newWebhook: WebhookConfig = {
      ...webhook,
      id: Date.now().toString(),
      createdAt: new Date().toISOString(),
    }

    this.webhooks.push(newWebhook)
    this.saveWebhooks()
    return newWebhook
  }

  updateWebhook(id: string, updates: Partial<WebhookConfig>): void {
    const index = this.webhooks.findIndex((wh) => wh.id === id)
    if (index !== -1) {
      this.webhooks[index] = { ...this.webhooks[index], ...updates }
      this.saveWebhooks()
    }
  }

  deleteWebhook(id: string): void {
    this.webhooks = this.webhooks.filter((wh) => wh.id !== id)
    this.saveWebhooks()
  }

  getWebhooks(): WebhookConfig[] {
    return this.webhooks
  }

  private saveWebhooks(): void {
    if (typeof window !== "undefined") {
      localStorage.setItem("webhooks", JSON.stringify(this.webhooks))
    }
  }
}
