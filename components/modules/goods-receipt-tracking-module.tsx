'use client';

import { useState, useEffect } from "react"
import { Card } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { useI18n } from "@/lib/i18n-context"
import { fill } from "@/lib/i18n-format"
import { formatDate } from "@/lib/format"
import { PageHeader } from "@/components/erp/page-header"
import { StatusBadge } from "@/components/erp/status-badge"
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
  const { t, language } = useI18n()
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
      console.error("Error loading goods receipts:", error)
    } finally {
      setLoading(false)
    }
  }

  const filteredReceipts = receipts.filter(
    (r) => filterStatus === "all" || r.status === filterStatus
  )

  const getDiscrepancyIcon = (type: string | null) => {
    if (!type) return null
    return <AlertCircle className="w-4 h-4 text-red-700" />
  }

  if (loading) {
    return <div className="p-4">{t("grt.loading")}</div>
  }

  return (
    <div className="space-y-6">
      <PageHeader
        group={t("group.inventory")}
        title={t("module.goods-receipt-tracking")}
        subtitle={t("grt.subtitle")}
      />

      {/* Filters */}
      <div className="flex flex-wrap gap-2">
        <Button
          variant={filterStatus === "all" ? "default" : "outline"}
          onClick={() => setFilterStatus("all")}
        >
          {fill(t("grt.filter-all"), { count: receipts.length })}
        </Button>
        <Button
          variant={filterStatus === "complete" ? "default" : "outline"}
          onClick={() => setFilterStatus("complete")}
        >
          {fill(t("grt.filter-complete"), { count: receipts.filter((r) => r.status === "complete").length })}
        </Button>
        <Button
          variant={filterStatus === "discrepancy" ? "default" : "outline"}
          onClick={() => setFilterStatus("discrepancy")}
        >
          {fill(t("grt.filter-discrepancies"), { count: receipts.filter((r) => r.status === "discrepancy").length })}
        </Button>
        <Button
          variant={filterStatus === "partial" ? "default" : "outline"}
          onClick={() => setFilterStatus("partial")}
        >
          {fill(t("grt.filter-partial"), { count: receipts.filter((r) => r.status === "partial").length })}
        </Button>
      </div>

      {/* Receipts List */}
      <div className="space-y-3">
        {filteredReceipts.length === 0 ? (
          <Card className="p-8 text-center text-muted-foreground">
            {t("grt.no-receipts")}
          </Card>
        ) : (
          filteredReceipts.map((receipt) => (
            <Card key={receipt.id} className="p-4">
              <div className="flex items-start justify-between flex-wrap gap-2">
                <div className="flex-1 min-w-0 break-words">
                  <div className="flex items-center gap-3 mb-2">
                    <h3 className="font-semibold text-lg">{receipt.grnNumber}</h3>
                    <StatusBadge status={receipt.status} />
                    {receipt.lines.some((l) => l.discrepancyType) && (
                      <div className="flex items-center gap-1 text-red-700">
                        <AlertCircle className="w-4 h-4" />
                        <span className="text-sm">{t("grt.has-issues")}</span>
                      </div>
                    )}
                  </div>

                  <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm mb-3">
                    <div>
                      <span className="text-muted-foreground">{t("po-number")}</span>
                      <p className="font-medium">{receipt.poNumber}</p>
                    </div>
                    <div>
                      <span className="text-muted-foreground">{t("grt.receipt-date")}</span>
                      <p className="font-medium">
                        {formatDate(receipt.receiptDate, language)}
                      </p>
                    </div>
                    <div>
                      <span className="text-muted-foreground">{t("grt.items-total-qty")}</span>
                      <p className="font-medium">
                        {fill(t("grt.items-units"), {
                          items: new Set(receipt.lines.map((l: any) => l.productId)).size,
                          units: receipt.lines.reduce((sum: number, l: any) => sum + (l.quantityReceived || 0), 0),
                        })}
                      </p>
                    </div>
                    <div>
                      <span className="text-muted-foreground">{t("inventory-audit.discrepancies")}</span>
                      <p className={`font-medium ${receipt.lines.filter((l) => l.discrepancyType).length > 0 ? 'text-red-700 text-lg' : ''}`}>
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
                  <Eye className="w-4 h-4 me-1" />
                  {t("details")}
                </Button>
              </div>

              {/* Expandable Details */}
              {selectedReceipt?.id === receipt.id && (
                <div className="mt-4 pt-4 border-t space-y-3">
                  <h4 className="font-semibold text-sm">{t("grt.items-received")}</h4>
                  <div className="space-y-2">
                    {receipt.lines.map((line) => (
                      <div
                        key={line.lineId}
                        className={`p-3 rounded border ${
                          line.discrepancyType ? "bg-red-50 border-red-200" : "bg-gray-50"
                        }`}
                      >
                        <div className="flex items-start justify-between gap-4 flex-wrap">
                          <div className="flex-1 min-w-0 break-words">
                            <div className="flex items-center gap-2 mb-1">
                              <p className="font-medium">{line.productName}</p>
                              {line.discrepancyType && (
                                <Badge variant="destructive" className="text-xs">
                                  {line.discrepancyType.replace(/_/g, " ")}
                                </Badge>
                              )}
                            </div>
                            <p className="text-sm text-muted-foreground mb-2">{t("common.sku-2")} {line.sku}</p>

                            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4 text-sm mb-2">
                              <div>
                                <span className="text-muted-foreground">{t("grt.ordered")}</span>
                                <p className="font-medium">{fill(t("grt.units-count"), { count: line.quantityOrdered })}</p>
                              </div>
                              <div>
                                <span className="text-muted-foreground">{t("po.status.received")}</span>
                                <p className="font-medium text-blue-600">
                                  {fill(t("grt.units-count"), { count: line.quantityReceived })}
                                </p>
                              </div>
                              <div>
                                <span className="text-muted-foreground">{t("approval.warehouse")}</span>
                                <p className="font-medium">{line.warehouseName || line.warehouse || t("grt.not-available")}</p>
                              </div>
                            </div>

                            {line.discrepancyNotes && (
                              <div className="mt-2 p-2 bg-yellow-50 border border-yellow-200 rounded text-sm">
                                <p className="font-medium text-yellow-900 mb-1">{t("grt.issue-details")}</p>
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
