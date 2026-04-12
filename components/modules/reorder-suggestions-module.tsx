"use client"

import { useState, useEffect } from "react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { useI18n } from "@/lib/i18n-context"
import {
  TrendingUp,
  TrendingDown,
  Minus,
  RefreshCw,
  CheckCircle,
  AlertTriangle,
  Package,
  Calculator,
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

  const getUrgencyBadge = (urgency: string) => {
    switch (urgency) {
      case "low_stock":
        return <Badge variant="destructive">{t("inventory.low-stock")}</Badge>
      case "near_reorder":
        return (
          <Badge variant="secondary" className="bg-amber-100 text-amber-800">
            {t("reorder.near-reorder")}
          </Badge>
        )
      default:
        return (
          <Badge variant="outline" className="text-green-600 border-green-600">
            {t("reorder.healthy")}
          </Badge>
        )
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

  return (
    <TooltipProvider>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
          <div>
            <h2 className="text-2xl font-bold flex items-center gap-2">
              <Calculator className="h-6 w-6" />
              {t("reorder.title")}
            </h2>
            <p className="text-muted-foreground">{t("reorder.description")}</p>
          </div>
          <Button onClick={fetchSuggestions} disabled={loading} variant="outline">
            <RefreshCw className={`h-4 w-4 mr-2 ${loading ? "animate-spin" : ""}`} />
            {t("reorder.recalculate")}
          </Button>
        </div>

        {/* Summary Cards */}
        {summary && (
          <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
            <Card>
              <CardHeader className="pb-2">
                <CardDescription>{t("reorder.total-products")}</CardDescription>
                <CardTitle className="text-2xl">{formatNumber(summary.totalProducts)}</CardTitle>
              </CardHeader>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardDescription>{t("reorder.needs-update")}</CardDescription>
                <CardTitle className="text-2xl text-amber-600">{formatNumber(summary.needsUpdate)}</CardTitle>
              </CardHeader>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardDescription>{t("inventory.low-stock")}</CardDescription>
                <CardTitle className="text-2xl text-red-600">{formatNumber(summary.lowStock)}</CardTitle>
              </CardHeader>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardDescription>{t("reorder.avg-daily-demand")}</CardDescription>
                <CardTitle className="text-2xl">{formatNumber(summary.averageDailyDemand)}</CardTitle>
              </CardHeader>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardDescription>{t("reorder.avg-lead-time")}</CardDescription>
                <CardTitle className="text-2xl">
                  {formatNumber(summary.averageLeadTime || 14)} {t("time.days")}
                </CardTitle>
              </CardHeader>
            </Card>
          </div>
        )}

        {/* Filters and Actions */}
        <Card>
          <CardHeader className="pb-3">
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
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
                  <AlertTriangle className="h-4 w-4 mr-1" />
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
                  <CheckCircle className="h-4 w-4 mr-1" />
                  {t("reorder.healthy")}
                </Button>
                <label className="flex items-center gap-2 ml-4">
                  <Checkbox
                    checked={showOnlyNeedsUpdate}
                    onCheckedChange={(checked) => setShowOnlyNeedsUpdate(checked as boolean)}
                  />
                  <span className="text-sm">{t("reorder.only-needs-update")}</span>
                </label>
              </div>
              <Button onClick={handleApplySelected} disabled={selectedItems.size === 0 || applying}>
                {applying ? (
                  <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
                ) : (
                  <CheckCircle className="h-4 w-4 mr-2" />
                )}
                {t("reorder.apply-selected")} ({formatNumber(selectedItems.size)})
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            {loading ? (
              <div className="flex items-center justify-center py-12">
                <RefreshCw className="h-8 w-8 animate-spin text-muted-foreground" />
                <span className="ml-2 text-muted-foreground">{t("reorder.analyzing")}</span>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-[50px]">
                        <Checkbox
                          checked={
                            filteredSuggestions.length > 0 &&
                            filteredSuggestions.every((s) => selectedItems.has(s.productId))
                          }
                          onCheckedChange={handleSelectAll}
                        />
                      </TableHead>
                      <TableHead>{t("field.product")}</TableHead>
                      <TableHead>{t("field.supplier")}</TableHead>
                      <TableHead className="text-center">{t("field.status")}</TableHead>
                      <TableHead className="text-center">{t("reorder.trend")}</TableHead>
                      <TableHead className="text-right">{t("reorder.current-qty")}</TableHead>
                      <TableHead className="text-right">{t("reorder.current-rop")}</TableHead>
                      <TableHead className="text-right">{t("reorder.suggested-rop")}</TableHead>
                      <TableHead className="text-right">{t("reorder.new-value")}</TableHead>
                      <TableHead className="text-right">{t("reorder.daily-demand")}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredSuggestions.map((item) => (
                      <TableRow key={item.productId} className={item.needsUpdate ? "bg-amber-50/50" : ""}>
                        <TableCell>
                          <Checkbox
                            checked={selectedItems.has(item.productId)}
                            onCheckedChange={(checked) => handleSelectItem(item.productId, checked as boolean)}
                          />
                        </TableCell>
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
                        <TableCell className="text-center">{getUrgencyBadge(item.urgency)}</TableCell>
                        <TableCell className="text-center">
                          <div className="flex items-center justify-center gap-1">
                            {getTrendIcon(item.demandTrend)}
                            <span className="text-xs">{getTrendLabel(item.demandTrend)}</span>
                          </div>
                        </TableCell>
                        <TableCell className="text-right">
                          <span
                            className={
                              item.currentQuantity <= item.currentReorderPoint ? "text-red-600 font-semibold" : ""
                            }
                          >
                            {formatNumber(item.currentQuantity)}
                          </span>
                        </TableCell>
                        <TableCell className="text-right">{formatNumber(item.currentReorderPoint)}</TableCell>
                        <TableCell className="text-right">
                          <div className="flex items-center justify-end gap-2">
                            <span className="font-semibold">{formatNumber(item.suggestedReorderPoint)}</span>
                            {item.difference !== 0 && (
                              <Badge variant={item.difference > 0 ? "default" : "secondary"} className="text-xs">
                                {item.difference > 0 ? "+" : ""}
                                {formatNumber(item.percentChange)}%
                              </Badge>
                            )}
                          </div>
                        </TableCell>
                        <TableCell className="text-right">
                          <Input
                            type="number"
                            className="w-20 h-8 text-right"
                            value={customValues[item.productId] || item.suggestedReorderPoint}
                            onChange={(e) => handleCustomValueChange(item.productId, e.target.value)}
                            min={1}
                          />
                        </TableCell>
                        <TableCell className="text-right">
                          {formatNumber(item.dailyDemand)} / {t("reorder.day")}
                        </TableCell>
                      </TableRow>
                    ))}
                    {filteredSuggestions.length === 0 && (
                      <TableRow>
                        <TableCell colSpan={11} className="text-center py-8 text-muted-foreground">
                          {t("reorder.no-items")}
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
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
