"use client"

import { useState, useEffect } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import { TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { useIsMobile } from "@/components/ui/use-mobile"
import { ErpTable, NumCell, NumHead } from "@/components/erp/data-table"
import { KpiGrid, KpiTile } from "@/components/erp/kpi-tile"
import { PageHeader } from "@/components/erp/page-header"
import { ListCard, ResponsiveList } from "@/components/erp/responsive-list"
import { StatusBadge } from "@/components/erp/status-badge"
import { useI18n } from "@/lib/i18n-context"
import {
  TrendingUp,
  TrendingDown,
  Minus,
  RefreshCw,
  CheckCircle,
  AlertTriangle,
  Package,
  ArrowRight,
  Truck,
} from "lucide-react"
import { TooltipProvider } from "@/components/ui/tooltip"

interface ReorderSuggestion {
  inventoryId: number
  productId: number
  productName: string
  sku: string
  unit: string
  currentQuantity: number
  currentReorderPoint: number
  suggestedReorderPoint: number
  difference: number
  percentChange: number
  dailyDemand: number
  totalSold90Days: number
  salesCount90Days: number
  demandTrend: "increasing" | "decreasing" | "stable"
  moq: number
  leadTimeDays: number
  supplierName: string // Added supplier name
  safetyStockDays: number
  needsUpdate: boolean
  urgency: "low_stock" | "near_reorder" | "healthy"
}

interface SuggestionSummary {
  totalProducts: number
  needsUpdate: number
  lowStock: number
  nearReorder: number
  averageDailyDemand: number
  averageLeadTime: number // Added average lead time
  analysisDate: string
  periodDays: number
}

export function ReorderSuggestionsModule() {
  const { t, formatNumber, language } = useI18n()
  const isMobile = useIsMobile()
  const [suggestions, setSuggestions] = useState<ReorderSuggestion[]>([])
  const [summary, setSummary] = useState<SuggestionSummary | null>(null)
  const [loading, setLoading] = useState(false)
  const [applying, setApplying] = useState(false)
  const [selectedItems, setSelectedItems] = useState<Set<number>>(new Set())
  const [customValues, setCustomValues] = useState<Record<number, number>>({})
  const [filterUrgency, setFilterUrgency] = useState<string>("all")
  const [showOnlyNeedsUpdate, setShowOnlyNeedsUpdate] = useState(false)

  const fetchSuggestions = async () => {
    setLoading(true)
    try {
      const res = await fetch("/api/inventory/reorder-suggestions")
      if (!res.ok) throw new Error("Failed to fetch suggestions")
      const data = await res.json()
      setSuggestions(data.suggestions || [])
      setSummary(data.summary || null)

      // Initialize custom values with suggested values
      const customs: Record<number, number> = {}
      data.suggestions?.forEach((s: ReorderSuggestion) => {
        customs[s.productId] = s.suggestedReorderPoint
      })
      setCustomValues(customs)
    } catch (error) {
      console.error("Error fetching suggestions:", error)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchSuggestions()
  }, [])

  const handleSelectAll = (checked: boolean) => {
    if (checked) {
      const filtered = getFilteredSuggestions()
      setSelectedItems(new Set(filtered.map((s) => s.productId)))
    } else {
      setSelectedItems(new Set())
    }
  }

  const handleSelectItem = (productId: number, checked: boolean) => {
    const newSelected = new Set(selectedItems)
    if (checked) {
      newSelected.add(productId)
    } else {
      newSelected.delete(productId)
    }
    setSelectedItems(newSelected)
  }

  const handleCustomValueChange = (productId: number, value: string) => {
    const numValue = Number.parseInt(value) || 0
    setCustomValues((prev) => ({ ...prev, [productId]: numValue }))
  }

  const handleApplySelected = async () => {
    if (selectedItems.size === 0) return

    setApplying(true)
    try {
      const updates = Array.from(selectedItems).map((productId) => ({
        productId,
        reorderPoint:
          customValues[productId] || suggestions.find((s) => s.productId === productId)?.suggestedReorderPoint || 0,
      }))

      const res = await fetch("/api/inventory/reorder-suggestions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ updates }),
      })

      if (!res.ok) throw new Error("Failed to apply updates")

      const result = await res.json()
      alert(`Successfully updated ${result.updated} reorder points!`)

      // Refresh suggestions
      setSelectedItems(new Set())
      fetchSuggestions()
    } catch (error) {
      console.error("Error applying updates:", error)
      alert("Failed to apply updates. Please try again.")
    } finally {
      setApplying(false)
    }
  }

  const getFilteredSuggestions = () => {
    let filtered = suggestions

    if (filterUrgency !== "all") {
      filtered = filtered.filter((s) => s.urgency === filterUrgency)
    }

    if (showOnlyNeedsUpdate) {
      filtered = filtered.filter((s) => s.needsUpdate)
    }

    return filtered
  }

  const getTrendIcon = (trend: string) => {
    switch (trend) {
      case "increasing":
        return <TrendingUp className="h-4 w-4 text-green-600" />
      case "decreasing":
        return <TrendingDown className="h-4 w-4 text-red-600" />
      default:
        return <Minus className="h-4 w-4 text-muted-foreground" />
    }
  }

  const getUrgencyLabel = (urgency: string) => {
    switch (urgency) {
      case "low_stock":
        return t("inventory.low-stock")
      case "near_reorder":
        return t("reorder.near-reorder")
      default:
        return t("reorder.healthy")
    }
  }

  const getTrendLabel = (trend: string) => {
    switch (trend) {
      case "increasing":
        return t("reorder.trend-increasing")
      case "decreasing":
        return t("reorder.trend-decreasing")
      default:
        return t("reorder.trend-stable")
    }
  }

  const filteredSuggestions = getFilteredSuggestions()

  const renderUrgencyBadge = (item: ReorderSuggestion) => (
    <StatusBadge status={item.urgency} label={getUrgencyLabel(item.urgency)} />
  )

  // The select-all checkbox: in the table head on desktop, above the card list on phones (one branch mounts).
  const selectAllCheckbox = (
    <Checkbox
      checked={filteredSuggestions.length > 0 && filteredSuggestions.every((s) => selectedItems.has(s.productId))}
      onCheckedChange={handleSelectAll}
    />
  )

  const renderRowCheckbox = (item: ReorderSuggestion) => (
    <Checkbox
      checked={selectedItems.has(item.productId)}
      onCheckedChange={(checked) => handleSelectItem(item.productId, checked as boolean)}
    />
  )

  const renderCustomInput = (item: ReorderSuggestion) => (
    <Input
      type="number"
      className="w-20 h-8 text-end"
      value={customValues[item.productId] || item.suggestedReorderPoint}
      onChange={(e) => handleCustomValueChange(item.productId, e.target.value)}
      min={1}
    />
  )

  // Every checkbox and input of a row, for the phone card.
  const renderRowActions = (item: ReorderSuggestion) => (
    <>
      {renderRowCheckbox(item)}
      <label className="flex items-center gap-2 text-xs text-muted-foreground">
        {t("reorder.new-value")}
        {renderCustomInput(item)}
      </label>
    </>
  )

  return (
    <TooltipProvider>
      <div className="space-y-6">
        <PageHeader
          group={t("group.inventory")}
          title={t("reorder.title")}
          subtitle={t("reorder.description")}
          actions={
            <Button onClick={fetchSuggestions} disabled={loading} variant="outline">
              <RefreshCw className={`h-4 w-4 me-2 ${loading ? "animate-spin" : ""}`} />
              {t("reorder.recalculate")}
            </Button>
          }
        />

        {/* Summary Cards */}
        {summary && (
          <KpiGrid>
            <KpiTile label={t("reorder.total-products")} value={formatNumber(summary.totalProducts)} />
            <KpiTile label={t("reorder.needs-update")} value={formatNumber(summary.needsUpdate)} />
            <KpiTile label={t("inventory.low-stock")} value={formatNumber(summary.lowStock)} />
            <KpiTile label={t("reorder.avg-daily-demand")} value={formatNumber(summary.averageDailyDemand)} />
            <KpiTile
              label={t("reorder.avg-lead-time")}
              value={`${formatNumber(summary.averageLeadTime || 14)} ${t("time.days")}`}
            />
          </KpiGrid>
        )}

        {/* Filters and Actions */}
        <Card>
          <CardHeader className="pb-3">
            <div className="flex max-sm:flex-col justify-between max-sm:items-start items-center gap-4">
              <div className="flex flex-wrap gap-2">
                <Button
                  variant={filterUrgency === "all" ? "default" : "outline"}
                  size="sm"
                  onClick={() => setFilterUrgency("all")}
                >
                  {t("ap.all-invoices")}
                </Button>
                <Button
                  variant={filterUrgency === "low_stock" ? "default" : "outline"}
                  size="sm"
                  onClick={() => setFilterUrgency("low_stock")}
                >
                  <AlertTriangle className="h-4 w-4 me-1" />
                  {t("inventory.low-stock")}
                </Button>
                <Button
                  variant={filterUrgency === "near_reorder" ? "default" : "outline"}
                  size="sm"
                  onClick={() => setFilterUrgency("near_reorder")}
                >
                  {t("reorder.near-reorder")}
                </Button>
                <Button
                  variant={filterUrgency === "healthy" ? "default" : "outline"}
                  size="sm"
                  onClick={() => setFilterUrgency("healthy")}
                >
                  <CheckCircle className="h-4 w-4 me-1" />
                  {t("reorder.healthy")}
                </Button>
                <label className="flex items-center gap-2 ms-4">
                  <Checkbox
                    checked={showOnlyNeedsUpdate}
                    onCheckedChange={(checked) => setShowOnlyNeedsUpdate(checked as boolean)}
                  />
                  <span className="text-sm">{t("reorder.only-needs-update")}</span>
                </label>
              </div>
              <Button onClick={handleApplySelected} disabled={selectedItems.size === 0 || applying}>
                {applying ? (
                  <RefreshCw className="h-4 w-4 me-2 animate-spin" />
                ) : (
                  <CheckCircle className="h-4 w-4 me-2" />
                )}
                {t("reorder.apply-selected")} ({formatNumber(selectedItems.size)})
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            {loading ? (
              <div className="flex items-center justify-center py-12">
                <RefreshCw className="h-8 w-8 animate-spin text-muted-foreground" />
                <span className="ms-2 text-muted-foreground">{t("reorder.analyzing")}</span>
              </div>
            ) : (
              <div className="space-y-3">
                {isMobile && filteredSuggestions.length > 0 && (
                  <label className="flex items-center gap-2 text-sm">
                    {selectAllCheckbox}
                    <span>Select all</span>
                  </label>
                )}
                <ResponsiveList
                  rows={filteredSuggestions}
                  empty={<div className="py-8 text-center text-muted-foreground">{t("reorder.no-items")}</div>}
                  table={
                    <ErpTable>
                      <TableHeader>
                        <TableRow>
                          <TableHead className="w-[50px]">{selectAllCheckbox}</TableHead>
                          <TableHead>{t("field.product")}</TableHead>
                          <TableHead>{t("field.supplier")}</TableHead>
                          <TableHead className="text-center">{t("field.status")}</TableHead>
                          <TableHead className="text-center">{t("reorder.trend")}</TableHead>
                          <NumHead>{t("reorder.current-qty")}</NumHead>
                          <NumHead>{t("reorder.current-rop")}</NumHead>
                          <NumHead>{t("reorder.suggested-rop")}</NumHead>
                          <NumHead>{t("reorder.new-value")}</NumHead>
                          <NumHead>{t("reorder.daily-demand")}</NumHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {filteredSuggestions.map((item) => (
                          <TableRow key={item.productId} className={item.needsUpdate ? "bg-amber-50/50" : ""}>
                            <TableCell>{renderRowCheckbox(item)}</TableCell>
                            <TableCell>
                              <div className="flex items-center gap-2">
                                <Package className="h-4 w-4 text-muted-foreground" />
                                <div>
                                  <div className="font-medium">{item.productName}</div>
                                  <div className="text-xs text-muted-foreground">{item.sku}</div>
                                </div>
                              </div>
                            </TableCell>
                            <TableCell>
                              <div className="flex items-center gap-2">
                                <Truck className="h-4 w-4 text-muted-foreground" />
                                <div>
                                  <div className="text-sm">{item.supplierName}</div>
                                  <div className="text-xs text-muted-foreground">
                                    {formatNumber(item.leadTimeDays)} {t("reorder.days-lead-time")}
                                  </div>
                                </div>
                              </div>
                            </TableCell>
                            <TableCell className="text-center">{renderUrgencyBadge(item)}</TableCell>
                            <TableCell className="text-center">
                              <div className="flex items-center justify-center gap-1">
                                {getTrendIcon(item.demandTrend)}
                                <span className="text-xs">{getTrendLabel(item.demandTrend)}</span>
                              </div>
                            </TableCell>
                            <NumCell>
                              <span
                                className={
                                  item.currentQuantity <= item.currentReorderPoint ? "text-red-600 font-semibold" : ""
                                }
                              >
                                {formatNumber(item.currentQuantity)}
                              </span>
                            </NumCell>
                            <NumCell>{formatNumber(item.currentReorderPoint)}</NumCell>
                            <NumCell>
                              <div className="flex items-center justify-end gap-2">
                                <span className="font-semibold">{formatNumber(item.suggestedReorderPoint)}</span>
                                {item.difference !== 0 && (
                                  <Badge variant={item.difference > 0 ? "default" : "secondary"} className="text-xs">
                                    {item.difference > 0 ? "+" : ""}
                                    {formatNumber(item.percentChange)}%
                                  </Badge>
                                )}
                              </div>
                            </NumCell>
                            <NumCell>{renderCustomInput(item)}</NumCell>
                            <NumCell>
                              {formatNumber(item.dailyDemand)} / {t("reorder.day")}
                            </NumCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </ErpTable>
                  }
                  card={(item) => (
                    <ListCard
                      id={item.productName}
                      party={item.supplierName}
                      status={renderUrgencyBadge(item)}
                      note={
                        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                          <span className="flex items-center gap-1">
                            {getTrendIcon(item.demandTrend)}
                            {getTrendLabel(item.demandTrend)}
                          </span>
                          <span>
                            {t("reorder.current-qty")}: {formatNumber(item.currentQuantity)}
                          </span>
                          <span>
                            {t("reorder.current-rop")}: {formatNumber(item.currentReorderPoint)}
                          </span>
                          <span>
                            {t("reorder.suggested-rop")}: {formatNumber(item.suggestedReorderPoint)}
                          </span>
                          <span>
                            {t("reorder.daily-demand")}: {formatNumber(item.dailyDemand)} / {t("reorder.day")}
                          </span>
                        </div>
                      }
                      actions={renderRowActions(item)}
                    />
                  )}
                />
              </div>
            )}
          </CardContent>
        </Card>

        {/* Formula Explanation */}
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">{t("reorder.formula-title")}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center gap-4 text-sm flex-wrap">
              <div className="flex items-center gap-2 bg-muted px-3 py-2 rounded">
                <span className="font-mono">{t("reorder.daily-demand")}</span>
              </div>
              <span>×</span>
              <div className="flex items-center gap-2 bg-muted px-3 py-2 rounded">
                <span className="font-mono">
                  ({t("reorder.lead-time")} + {t("reorder.safety-days")})
                </span>
              </div>
              <ArrowRight className="h-4 w-4" />
              <div className="flex items-center gap-2 bg-primary/10 px-3 py-2 rounded">
                <span className="font-mono font-semibold">{t("reorder.suggested-rop")}</span>
              </div>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-sm">
              <div>
                <h4 className="font-semibold mb-1">{t("reorder.daily-demand")}</h4>
                <p className="text-muted-foreground">{t("reorder.daily-demand-desc")}</p>
              </div>
              <div>
                <h4 className="font-semibold mb-1">{t("reorder.supplier-lead-time")}</h4>
                <p className="text-muted-foreground">{t("reorder.supplier-lead-time-desc")}</p>
              </div>
              <div>
                <h4 className="font-semibold mb-1">{t("reorder.safety-stock")}</h4>
                <p className="text-muted-foreground">{t("reorder.safety-stock-desc")}</p>
              </div>
            </div>
            <div className="flex gap-4 text-sm pt-2 border-t flex-wrap">
              <div className="flex items-center gap-2">
                <TrendingUp className="h-4 w-4 text-green-600" />
                <span>{t("reorder.increasing-buffer")}</span>
              </div>
              <div className="flex items-center gap-2">
                <TrendingDown className="h-4 w-4 text-red-600" />
                <span>{t("reorder.decreasing-reduction")}</span>
              </div>
              <div className="flex items-center gap-2">
                <Minus className="h-4 w-4 text-muted-foreground" />
                <span>{t("reorder.stable-no-adjustment")}</span>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </TooltipProvider>
  )
}
