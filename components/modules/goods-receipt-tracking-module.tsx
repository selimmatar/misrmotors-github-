'use client';

import { useState, useEffect } from "react"
import { Card } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { useAppContext } from "@/lib/app-context"
import { AlertCircle, CheckCircle, Eye, Download } from "lucide-react"

interface GoodsReceipt {
  id: string
  grnNumber: string
  poId: string
  poNumber: string
  status: "pending" | "partial" | "complete" | "discrepancy"
  receiptDate: string
  receivedBy: string
  notes: string
  lines: Array<{
    lineId: string
    productId: string
    productName: string
    sku: string
    quantityOrdered: number
    quantityReceived: number
    discrepancyType: string | null
    discrepancyNotes: string
    warehouse: string
  }>
}

export function GoodsReceiptTrackingModule() {
  const { t } = useAppContext()
  const [receipts, setReceipts] = useState<GoodsReceipt[]>([])
  const [loading, setLoading] = useState(true)
  const [selectedReceipt, setSelectedReceipt] = useState<GoodsReceipt | null>(null)
  const [filterStatus, setFilterStatus] = useState<string>("all")

  useEffect(() => {
    loadReceipts()
  }, [])

  const loadReceipts = async () => {
    try {
      const response = await fetch("/api/goods-receipts")
      if (!response.ok) throw new Error("Failed to fetch receipts")
      const data = await response.json()
      setReceipts(data)
    } catch (error) {
      console.error("[v0] Error loading goods receipts:", error)
    } finally {
      setLoading(false)
    }
  }

  const filteredReceipts = receipts.filter(
    (r) => filterStatus === "all" || r.status === filterStatus
  )

  const getStatusColor = (status: string) => {
    switch (status) {
      case "complete":
        return "bg-green-100 text-green-800"
      case "partial":
        return "bg-yellow-100 text-yellow-800"
      case "discrepancy":
        return "bg-red-100 text-red-800"
      case "pending":
        return "bg-gray-100 text-gray-800"
      default:
        return "bg-gray-100 text-gray-800"
    }
  }

  const getDiscrepancyIcon = (type: string | null) => {
    if (!type) return null
    return <AlertCircle className="w-4 h-4 text-red-500" />
  }

  if (loading) {
    return <div className="p-4">Loading goods receipts...</div>
  }

  return (
    <div className="space-y-6 p-6">
      <div>
        <h2 className="text-2xl font-bold mb-2">Goods Receipt Tracking</h2>
        <p className="text-muted-foreground">
          View all received POs, discrepancies, and adjusted quantities
        </p>
      </div>

      {/* Filters */}
      <div className="flex gap-2">
        <Button
          variant={filterStatus === "all" ? "default" : "outline"}
          onClick={() => setFilterStatus("all")}
        >
          All ({receipts.length})
        </Button>
        <Button
          variant={filterStatus === "complete" ? "default" : "outline"}
          onClick={() => setFilterStatus("complete")}
        >
          Complete ({receipts.filter((r) => r.status === "complete").length})
        </Button>
        <Button
          variant={filterStatus === "discrepancy" ? "default" : "outline"}
          onClick={() => setFilterStatus("discrepancy")}
        >
          Discrepancies ({receipts.filter((r) => r.status === "discrepancy").length})
        </Button>
        <Button
          variant={filterStatus === "partial" ? "default" : "outline"}
          onClick={() => setFilterStatus("partial")}
        >
          Partial ({receipts.filter((r) => r.status === "partial").length})
        </Button>
      </div>

      {/* Receipts List */}
      <div className="space-y-3">
        {filteredReceipts.length === 0 ? (
          <Card className="p-8 text-center text-muted-foreground">
            No goods receipts found
          </Card>
        ) : (
          filteredReceipts.map((receipt) => (
            <Card key={receipt.id} className="p-4">
              <div className="flex items-start justify-between">
                <div className="flex-1">
                  <div className="flex items-center gap-3 mb-2">
                    <h3 className="font-semibold text-lg">{receipt.grnNumber}</h3>
                    <Badge className={getStatusColor(receipt.status)}>
                      {receipt.status.toUpperCase()}
                    </Badge>
                    {receipt.lines.some((l) => l.discrepancyType) && (
                      <div className="flex items-center gap-1 text-red-600">
                        <AlertCircle className="w-4 h-4" />
                        <span className="text-sm">Has Issues</span>
                      </div>
                    )}
                  </div>

                  <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm mb-3">
                    <div>
                      <span className="text-muted-foreground">PO Number</span>
                      <p className="font-medium">{receipt.poNumber}</p>
                    </div>
                    <div>
                      <span className="text-muted-foreground">Receipt Date</span>
                      <p className="font-medium">
                        {new Date(receipt.receiptDate).toLocaleDateString()}
                      </p>
                    </div>
                    <div>
                      <span className="text-muted-foreground">Items / Total Qty</span>
                      <p className="font-medium">
                        {new Set(receipt.lines.map((l: any) => l.productId)).size} items / {receipt.lines.reduce((sum: number, l: any) => sum + (l.quantityReceived || 0), 0)} units
                      </p>
                    </div>
                    <div>
                      <span className="text-muted-foreground">Discrepancies</span>
                      <p className={`font-medium ${receipt.lines.filter((l) => l.discrepancyType).length > 0 ? 'text-red-600 text-lg' : ''}`}>
                        {receipt.lines.filter((l) => l.discrepancyType).length}
                      </p>
                    </div>
                  </div>

                  {receipt.notes && (
                    <p className="text-sm text-muted-foreground bg-gray-50 p-2 rounded mb-3">
                      {receipt.notes}
                    </p>
                  )}
                </div>

                <Button
                  variant="outline"
                  size="sm"
                  onClick={() =>
                    setSelectedReceipt(selectedReceipt?.id === receipt.id ? null : receipt)
                  }
                >
                  <Eye className="w-4 h-4 mr-1" />
                  Details
                </Button>
              </div>

              {/* Expandable Details */}
              {selectedReceipt?.id === receipt.id && (
                <div className="mt-4 pt-4 border-t space-y-3">
                  <h4 className="font-semibold text-sm">Items Received</h4>
                  <div className="space-y-2">
                    {receipt.lines.map((line) => (
                      <div
                        key={line.lineId}
                        className={`p-3 rounded border ${
                          line.discrepancyType ? "bg-red-50 border-red-200" : "bg-gray-50"
                        }`}
                      >
                        <div className="flex items-start justify-between gap-4">
                          <div className="flex-1">
                            <div className="flex items-center gap-2 mb-1">
                              <p className="font-medium">{line.productName}</p>
                              {line.discrepancyType && (
                                <Badge variant="destructive" className="text-xs">
                                  {line.discrepancyType.replace(/_/g, " ")}
                                </Badge>
                              )}
                            </div>
                            <p className="text-sm text-muted-foreground mb-2">SKU: {line.sku}</p>

                            <div className="grid grid-cols-3 gap-4 text-sm mb-2">
                              <div>
                                <span className="text-muted-foreground">Ordered</span>
                                <p className="font-medium">{line.quantityOrdered} units</p>
                              </div>
                              <div>
                                <span className="text-muted-foreground">Received</span>
                                <p className="font-medium text-blue-600">
                                  {line.quantityReceived} units
                                </p>
                              </div>
                              <div>
                                <span className="text-muted-foreground">Warehouse</span>
                                <p className="font-medium">{line.warehouseName || line.warehouse || "N/A"}</p>
                              </div>
                            </div>

                            {line.discrepancyNotes && (
                              <div className="mt-2 p-2 bg-yellow-50 border border-yellow-200 rounded text-sm">
                                <p className="font-medium text-yellow-900 mb-1">Issue Details:</p>
                                <p className="text-yellow-800">{line.discrepancyNotes}</p>
                              </div>
                            )}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </Card>
          ))
        )}
      </div>
    </div>
  )
}
