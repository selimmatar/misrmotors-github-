"use client"

import { useState, useEffect } from "react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Badge } from "@/components/ui/badge"
import { Plus, Trash2, Power, PowerOff } from "lucide-react"
import type { WebhookConfig, WebhookEvent } from "@/lib/types"

const WEBHOOK_EVENTS: { value: WebhookEvent; label: string; description: string }[] = [
  {
    value: "sales_order.created",
    label: "Sales Order Created",
    description: "Triggered when a new sales order is created",
  },
  {
    value: "sales_order.approved",
    label: "Sales Order Approved",
    description: "Triggered when a sales order is approved",
  },
  {
    value: "purchase_order.created",
    label: "Purchase Order Created",
    description: "Triggered when a new purchase order is created",
  },
  {
    value: "purchase_order.approved",
    label: "Purchase Order Approved",
    description: "Triggered when a purchase order is approved",
  },
  {
    value: "inventory.low_stock",
    label: "Low Stock Alert",
    description: "Triggered when inventory falls below reorder point",
  },
  { value: "payment.received", label: "Payment Received", description: "Triggered when a payment is received" },
  { value: "invoice.uploaded", label: "Invoice Uploaded", description: "Triggered when an invoice is uploaded" },
  { value: "customer.created", label: "Customer Created", description: "Triggered when a new customer is added" },
  { value: "supplier.created", label: "Supplier Created", description: "Triggered when a new supplier is added" },
]

export function WebhookModule() {
  const [webhooks, setWebhooks] = useState<WebhookConfig[]>([])
  const [isAddingWebhook, setIsAddingWebhook] = useState(false)
  const [newWebhook, setNewWebhook] = useState({
    name: "",
    url: "",
    event: "sales_order.created" as WebhookEvent,
    enabled: true,
  })

  useEffect(() => {
    fetchWebhooks()
  }, [])

  const fetchWebhooks = async () => {
    try {
      const response = await fetch("/api/webhooks")
      if (response.ok) {
        const data = await response.json()
        setWebhooks(data)
      }
    } catch (error) {
      console.error("Failed to fetch webhooks:", error)
    }
  }

  const handleAddWebhook = async () => {
    try {
      const response = await fetch("/api/webhooks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(newWebhook),
      })

      if (response.ok) {
        await fetchWebhooks()
        setIsAddingWebhook(false)
        setNewWebhook({
          name: "",
          url: "",
          event: "sales_order.created",
          enabled: true,
        })
      }
    } catch (error) {
      console.error("Failed to add webhook:", error)
    }
  }

  const handleToggleWebhook = async (id: string, enabled: boolean) => {
    try {
      await fetch("/api/webhooks", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, enabled: !enabled }),
      })
      await fetchWebhooks()
    } catch (error) {
      console.error("Failed to toggle webhook:", error)
    }
  }

  const handleDeleteWebhook = async (id: string) => {
    try {
      await fetch(`/api/webhooks?id=${id}`, {
        method: "DELETE",
      })
      await fetchWebhooks()
    } catch (error) {
      console.error("Failed to delete webhook:", error)
    }
  }

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">n8n Webhook Integration</h1>
          <p className="text-muted-foreground mt-1">Connect your business system to n8n workflows</p>
        </div>
        <Button onClick={() => setIsAddingWebhook(true)}>
          <Plus className="w-4 h-4 mr-2" />
          Add Webhook
        </Button>
      </div>

      {isAddingWebhook && (
        <Card>
          <CardHeader>
            <CardTitle>Add New Webhook</CardTitle>
            <CardDescription>Configure a webhook endpoint to trigger n8n workflows</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <Label htmlFor="webhook-name">Webhook Name</Label>
              <Input
                id="webhook-name"
                placeholder="e.g., Order Notification"
                value={newWebhook.name}
                onChange={(e) => setNewWebhook({ ...newWebhook, name: e.target.value })}
              />
            </div>
            <div>
              <Label htmlFor="webhook-url">n8n Webhook URL</Label>
              <Input
                id="webhook-url"
                placeholder="https://your-n8n-instance.com/webhook/..."
                value={newWebhook.url}
                onChange={(e) => setNewWebhook({ ...newWebhook, url: e.target.value })}
              />
            </div>
            <div>
              <Label htmlFor="webhook-event">Event Trigger</Label>
              <select
                id="webhook-event"
                className="w-full p-2 border rounded-md"
                value={newWebhook.event}
                onChange={(e) => setNewWebhook({ ...newWebhook, event: e.target.value as WebhookEvent })}
              >
                {WEBHOOK_EVENTS.map((event) => (
                  <option key={event.value} value={event.value}>
                    {event.label}
                  </option>
                ))}
              </select>
              <p className="text-sm text-muted-foreground mt-1">
                {WEBHOOK_EVENTS.find((e) => e.value === newWebhook.event)?.description}
              </p>
            </div>
            <div className="flex gap-2">
              <Button onClick={handleAddWebhook}>Add Webhook</Button>
              <Button variant="outline" onClick={() => setIsAddingWebhook(false)}>
                Cancel
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      <div className="grid gap-4">
        {webhooks.length === 0 && !isAddingWebhook && (
          <Card>
            <CardContent className="flex flex-col items-center justify-center py-12">
              <p className="text-muted-foreground">No webhooks configured yet</p>
              <Button className="mt-4" onClick={() => setIsAddingWebhook(true)}>
                <Plus className="w-4 h-4 mr-2" />
                Add Your First Webhook
              </Button>
            </CardContent>
          </Card>
        )}

        {webhooks.map((webhook) => (
          <Card key={webhook.id}>
            <CardHeader>
              <div className="flex items-start justify-between">
                <div>
                  <CardTitle className="flex items-center gap-2">
                    {webhook.name}
                    {webhook.enabled ? (
                      <Badge className="bg-green-500">Active</Badge>
                    ) : (
                      <Badge variant="secondary">Disabled</Badge>
                    )}
                  </CardTitle>
                  <CardDescription className="mt-1">
                    {WEBHOOK_EVENTS.find((e) => e.value === webhook.event)?.label}
                  </CardDescription>
                </div>
                <div className="flex gap-2">
                  <Button
                    size="icon"
                    variant="outline"
                    onClick={() => handleToggleWebhook(webhook.id, webhook.enabled)}
                  >
                    {webhook.enabled ? <PowerOff className="w-4 h-4" /> : <Power className="w-4 h-4" />}
                  </Button>
                  <Button size="icon" variant="outline" onClick={() => handleDeleteWebhook(webhook.id)}>
                    <Trash2 className="w-4 h-4" />
                  </Button>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              <div className="space-y-2">
                <div>
                  <p className="text-sm font-medium">Webhook URL</p>
                  <code className="text-sm bg-muted p-2 rounded block break-all">{webhook.url}</code>
                </div>
                <div>
                  <p className="text-sm font-medium">Event</p>
                  <p className="text-sm text-muted-foreground">
                    {WEBHOOK_EVENTS.find((e) => e.value === webhook.event)?.description}
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Integration Guide</CardTitle>
          <CardDescription>How to use webhooks with n8n</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <h3 className="font-semibold mb-2">Step 1: Create a Webhook in n8n</h3>
            <p className="text-sm text-muted-foreground">
              In your n8n workflow, add a "Webhook" trigger node and copy the webhook URL.
            </p>
          </div>
          <div>
            <h3 className="font-semibold mb-2">Step 2: Add Webhook Here</h3>
            <p className="text-sm text-muted-foreground">
              Click "Add Webhook" above and paste your n8n webhook URL. Select the event that should trigger it.
            </p>
          </div>
          <div>
            <h3 className="font-semibold mb-2">Step 3: Test Your Webhook</h3>
            <p className="text-sm text-muted-foreground">
              Perform an action in the system (like creating a sales order) and check if your n8n workflow receives the
              data.
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
