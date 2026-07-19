"use client"

import { useState, useEffect } from "react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog"
import { Badge } from "@/components/ui/badge"
import { useI18n } from "@/lib/i18n-context"
import { useAppContext } from "@/lib/app-context"
import { Plus, ArrowRight, Package, Trash2, CheckCircle, Eye, Loader2 } from "lucide-react"
import type { UserRole } from "@/lib/types"

interface TransferItem {
  inventoryId: number
  productId: string | null
  productName: string
  sku: string
  isOutsourced: boolean
  quantity: number
  availableQty: number
}

interface Transfer {
  id: number
  transferNumber: string
  fromWarehouseId: number
  fromWarehouseName: string
  toWarehouseId: number
  toWarehouseName: string
  status: string
  notes: string
  createdAt: string
  completedAt: string | null
  items: {
    id: number
    productId: number
    productName: string
    sku: string
    quantity: number
  }[]
}

interface WarehouseTransfersModuleProps {
  userRole: UserRole
}

export function WarehouseTransfersModule({ userRole }: WarehouseTransfersModuleProps) {
  const { t, formatNumber, formatDate } = useI18n()
  const { warehouses, inventory, refreshInventory } = useAppContext()

  const [transfers, setTransfers] = useState<Transfer[]>([])
  const [loading, setLoading] = useState(true)
  const [showCreateDialog, setShowCreateDialog] = useState(false)
  const [showDetailsDialog, setShowDetailsDialog] = useState(false)
  const [selectedTransfer, setSelectedTransfer] = useState<Transfer | null>(null)
  const [actionLoading, setActionLoading] = useState(false)

  // Form state
  const [fromWarehouseId, setFromWarehouseId] = useState("")
  const [toWarehouseId, setToWarehouseId] = useState("")
  const [notes, setNotes] = useState("")
  const [transferItems, setTransferItems] = useState<TransferItem[]>([])

  // Product selection
  const [selectedProductId, setSelectedProductId] = useState("")
  const [transferQty, setTransferQty] = useState(1)

  useEffect(() => {
    fetchTransfers()
  }, [])

  const fetchTransfers = async () => {
    try {
      setLoading(true)
      const response = await fetch("/api/warehouse-transfers")
      if (!response.ok) throw new Error("Failed to fetch transfers")
      const data = await response.json()
      setTransfers(data)
    } catch (error) {
      console.error("[v0] Error fetching transfers:", error)
    } finally {
      setLoading(false)
    }
  }

  const getAvailableProducts = () => {
    if (!fromWarehouseId) return []
    return (inventory || []).filter(
      (inv: any) => inv.warehouseId?.toString() === fromWarehouseId && inv.quantity > 0
    )
  }

  const handleAddItem = () => {
    if (!selectedProductId) return

    // selectedProductId now holds the inventoryId (works for both products and outsourced items)
    const product = getAvailableProducts().find(
      (p: any) => p.inventoryId?.toString() === selectedProductId
    )
    if (!product) return

    // Check if already added
    if (transferItems.find((item) => item.inventoryId?.toString() === selectedProductId)) {
      alert("Item already added to transfer")
      return
    }

    setTransferItems([
      ...transferItems,
      {
        inventoryId: product.inventoryId,
        productId: product.productId || null,
        productName: product.isOutsourced ? (product.outsourcedName || product.productName) : product.productName,
        sku: product.sku || "",
        isOutsourced: product.isOutsourced || false,
        quantity: transferQty,
        availableQty: product.quantity,
      },
    ])
    setSelectedProductId("")
    setTransferQty(1)
  }

  const handleRemoveItem = (inventoryId: any) => {
    setTransferItems(transferItems.filter((item) => item.inventoryId !== inventoryId))
  }

  const handleCreateTransfer = async () => {
    if (!fromWarehouseId || !toWarehouseId || transferItems.length === 0) {
      alert("Please select warehouses and add items")
      return
    }

    try {
      setActionLoading(true)
      const response = await fetch("/api/warehouse-transfers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fromWarehouseId: parseInt(fromWarehouseId),
          toWarehouseId: parseInt(toWarehouseId),
          items: transferItems.map((item) => ({
            inventoryId: item.inventoryId,
            productId: item.productId ? parseInt(item.productId) : null,
            productName: item.productName,
            isOutsourced: item.isOutsourced || false,
            quantity: item.quantity,
          })),
          notes,
        }),
      })

      if (!response.ok) {
        const error = await response.json()
        throw new Error(error.error || "Failed to create transfer")
      }

      const result = await response.json()
      alert(`Transfer ${result.transfer.transferNumber} created successfully!`)

      // Reset form
      setFromWarehouseId("")
      setToWarehouseId("")
      setNotes("")
      setTransferItems([])
      setShowCreateDialog(false)
      fetchTransfers()
    } catch (error: any) {
      alert(error.message || "Failed to create transfer")
    } finally {
      setActionLoading(false)
    }
  }

  const handleCompleteTransfer = async (transferId: number) => {
    if (!confirm("Complete this transfer? This will move inventory between warehouses.")) return

    
    try {
      setActionLoading(true)
      const response = await fetch("/api/warehouse-transfers/complete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ transferId }),
      })


      if (!response.ok) {
        const error = await response.json()
        console.error("[v0] Transfer complete error:", error)
        throw new Error(error.error || "Failed to complete transfer")
      }

      const result = await response.json()
      
      alert("Transfer completed successfully!")
      await fetchTransfers()
      await refreshInventory()
      setShowDetailsDialog(false)
    } catch (error: any) {
      console.error("[v0] Transfer completion failed:", error)
      alert(error.message || "Failed to complete transfer")
    } finally {
      setActionLoading(false)
    }
  }

  const getStatusBadge = (status: string) => {
    const variants: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
      pending: "secondary",
      in_transit: "default",
      completed: "outline",
      cancelled: "destructive",
    }
    return <Badge variant={variants[status] || "secondary"}>{status.replace("_", " ").toUpperCase()}</Badge>
  }

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h2 className="text-2xl font-bold">Warehouse Transfers</h2>
        <Button onClick={() => setShowCreateDialog(true)}>
          <Plus className="w-4 h-4 mr-2" />
          New Transfer
        </Button>
      </div>

      {loading ? (
        <div className="flex justify-center p-8">
          <Loader2 className="w-8 h-8 animate-spin" />
        </div>
      ) : transfers.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center p-8">
            <Package className="w-12 h-12 text-muted-foreground mb-4" />
            <p className="text-muted-foreground">No transfers found</p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4">
          {transfers.map((transfer) => (
            <Card key={transfer.id} className="hover:shadow-md transition-shadow">
              <CardContent className="p-4">
                <div className="flex justify-between items-start">
                  <div className="flex-1">
                    <div className="flex items-center gap-3 mb-2">
                      <span className="font-semibold">{transfer.transferNumber}</span>
                      {getStatusBadge(transfer.status)}
                    </div>
                    <div className="flex items-center gap-2 text-sm text-muted-foreground">
                      <span>{transfer.fromWarehouseName}</span>
                      <ArrowRight className="w-4 h-4" />
                      <span>{transfer.toWarehouseName}</span>
                    </div>
                    <p className="text-sm text-muted-foreground mt-1">
                      {transfer.items.length} item(s) | Created: {formatDate(transfer.createdAt)}
                    </p>
                  </div>
                  <div className="flex gap-2">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => {
                        setSelectedTransfer(transfer)
                        setShowDetailsDialog(true)
                      }}
                    >
                      <Eye className="w-4 h-4" />
                    </Button>
                    {(transfer.status === "pending" || transfer.status === "in_transit") && (
                      <Button
                        variant="default"
                        size="sm"
                        onClick={() => handleCompleteTransfer(transfer.id)}
                        disabled={actionLoading}
                      >
                        <CheckCircle className="w-4 h-4 mr-1" />
                        Complete
                      </Button>
                    )}
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Create Transfer Dialog */}
      <Dialog open={showCreateDialog} onOpenChange={setShowCreateDialog}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Create Warehouse Transfer</DialogTitle>
          </DialogHeader>

          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label>From Warehouse</Label>
                <Select value={fromWarehouseId} onValueChange={setFromWarehouseId}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select source warehouse" />
                  </SelectTrigger>
                  <SelectContent>
                    {(warehouses || []).filter((wh: any) => wh.id && wh.id.toString().trim() !== "").map((wh: any) => (
                      <SelectItem key={wh.id} value={wh.id.toString()}>
                        {wh.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>To Warehouse</Label>
                <Select value={toWarehouseId} onValueChange={setToWarehouseId}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select destination warehouse" />
                  </SelectTrigger>
                  <SelectContent>
                    {(warehouses || [])
                      .filter((wh: any) => wh.id && wh.id.toString().trim() !== "" && wh.id.toString() !== fromWarehouseId)
                      .map((wh: any) => (
                        <SelectItem key={wh.id} value={wh.id.toString()}>
                          {wh.name}
                        </SelectItem>
                      ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            {fromWarehouseId && (
              <div className="border rounded-lg p-4 space-y-3">
                <Label>Add Products to Transfer</Label>
                <div className="flex gap-2">
                  <Select value={selectedProductId} onValueChange={setSelectedProductId}>
                    <SelectTrigger className="flex-1">
                      <SelectValue placeholder="Select product" />
                    </SelectTrigger>
                    <SelectContent>
                      {getAvailableProducts().filter((product: any) => product.inventoryId != null).map((product: any) => (
                        <SelectItem key={product.inventoryId} value={product.inventoryId.toString()}>
                          {product.isOutsourced ? (product.outsourcedName || product.productName) : product.productName}
                          {product.isOutsourced ? " (Outsourced)" : ""} (Avail: {product.quantity})
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Input
                    type="number"
                    min={1}
                    value={transferQty}
                    onChange={(e) => setTransferQty(parseInt(e.target.value) || 1)}
                    className="w-24"
                    placeholder="Qty"
                  />
                  <Button onClick={handleAddItem} disabled={!selectedProductId}>
                    <Plus className="w-4 h-4" />
                  </Button>
                </div>

                {transferItems.length > 0 && (
                  <div className="border rounded-lg divide-y">
                    {transferItems.map((item) => (
                      <div key={item.inventoryId} className="flex justify-between items-center p-3">
                        <div>
                          <p className="font-medium">
                            {item.productName}
                            {item.isOutsourced ? <span className="ml-2 text-xs text-amber-600">(Outsourced)</span> : null}
                          </p>
                          <p className="text-sm text-muted-foreground">
                            {item.sku ? `SKU: ${item.sku} | ` : ""}Qty: {item.quantity} (Avail: {item.availableQty})
                          </p>
                        </div>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleRemoveItem(item.inventoryId)}
                        >
                          <Trash2 className="w-4 h-4 text-red-500" />
                        </Button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            <div>
              <Label>Notes (Optional)</Label>
              <Textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Transfer notes..."
              />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setShowCreateDialog(false)}>
              Cancel
            </Button>
            <Button
              onClick={handleCreateTransfer}
              disabled={actionLoading || !fromWarehouseId || !toWarehouseId || transferItems.length === 0}
            >
              {actionLoading ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
              Create Transfer
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Transfer Details Dialog */}
      <Dialog open={showDetailsDialog} onOpenChange={setShowDetailsDialog}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Transfer Details</DialogTitle>
          </DialogHeader>

          {selectedTransfer && (
            <div className="space-y-4">
              <div className="flex justify-between items-center">
                <span className="font-semibold text-lg">{selectedTransfer.transferNumber}</span>
                {getStatusBadge(selectedTransfer.status)}
              </div>

              <div className="grid grid-cols-2 gap-4 text-sm">
                <div>
                  <p className="text-muted-foreground">From</p>
                  <p className="font-medium">{selectedTransfer.fromWarehouseName}</p>
                </div>
                <div>
                  <p className="text-muted-foreground">To</p>
                  <p className="font-medium">{selectedTransfer.toWarehouseName}</p>
                </div>
                <div>
                  <p className="text-muted-foreground">Created</p>
                  <p>{formatDate(selectedTransfer.createdAt)}</p>
                </div>
                {selectedTransfer.completedAt && (
                  <div>
                    <p className="text-muted-foreground">Completed</p>
                    <p>{formatDate(selectedTransfer.completedAt)}</p>
                  </div>
                )}
              </div>

              <div>
                <p className="text-muted-foreground mb-2">Items</p>
                <div className="border rounded-lg divide-y">
                  {selectedTransfer.items.map((item) => (
                    <div key={item.id} className="flex justify-between items-center p-3">
                      <div>
                        <p className="font-medium">{item.productName}</p>
                        <p className="text-sm text-muted-foreground">SKU: {item.sku}</p>
                      </div>
                      <span className="font-semibold">x{item.quantity}</span>
                    </div>
                  ))}
                </div>
              </div>

              {selectedTransfer.notes && (
                <div>
                  <p className="text-muted-foreground">Notes</p>
                  <p>{selectedTransfer.notes}</p>
                </div>
              )}

              {(selectedTransfer.status === "pending" || selectedTransfer.status === "in_transit") && (
                <Button
                  className="w-full"
                  onClick={() => handleCompleteTransfer(selectedTransfer.id)}
                  disabled={actionLoading}
                >
                  {actionLoading ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
                  <CheckCircle className="w-4 h-4 mr-2" />
                  Complete Transfer
                </Button>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}
