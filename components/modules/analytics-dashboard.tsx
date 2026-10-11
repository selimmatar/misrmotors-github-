"use client"

import type React from "react"

import { useState, useEffect } from "react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  TrendingUp,
  DollarSign,
  Package,
  Users,
  ShoppingCart,
  AlertTriangle,
  CheckCircle,
  Loader2,
  BarChart3,
  Activity,
  ArrowRight,
  Building2,
  Lightbulb,
  ChevronDown,
} from "lucide-react"
import dynamic from "next/dynamic"
import type { UserRole } from "@/lib/types"
import { useI18n } from "@/lib/i18n-context"
import { PageHeader } from "@/components/erp/page-header"
import { KpiGrid, KpiTile } from "@/components/erp/kpi-tile"
import { Money } from "@/components/erp/money"

const BarChart = dynamic(() => import("recharts").then((mod) => mod.BarChart), { ssr: false })
const Bar = dynamic(() => import("recharts").then((mod) => mod.Bar), { ssr: false })
const LineChart = dynamic(() => import("recharts").then((mod) => mod.LineChart), { ssr: false })
const Line = dynamic(() => import("recharts").then((mod) => mod.Line), { ssr: false })
const AreaChart = dynamic(() => import("recharts").then((mod) => mod.AreaChart), { ssr: false })
const Area = dynamic(() => import("recharts").then((mod) => mod.Area), { ssr: false })
const PieChartComp = dynamic(() => import("recharts").then((mod) => mod.PieChart), { ssr: false })
const Pie = dynamic(() => import("recharts").then((mod) => mod.Pie), { ssr: false })
const Cell = dynamic(() => import("recharts").then((mod) => mod.Cell), { ssr: false })
const XAxis = dynamic(() => import("recharts").then((mod) => mod.XAxis), { ssr: false })
const YAxis = dynamic(() => import("recharts").then((mod) => mod.YAxis), { ssr: false })
const CartesianGrid = dynamic(() => import("recharts").then((mod) => mod.CartesianGrid), { ssr: false })
const Tooltip = dynamic(() => import("recharts").then((mod) => mod.Tooltip), { ssr: false })
const Legend = dynamic(() => import("recharts").then((mod) => mod.Legend), { ssr: false })
const ResponsiveContainer = dynamic(() => import("recharts").then((mod) => mod.ResponsiveContainer), { ssr: false })

interface AnalyticsDashboardProps {
  userRole: UserRole
}

const roleVisibleTabs: Record<UserRole, string[]> = {
  ceo: ["executive", "sales", "inventory", "financial", "operations", "predictions"],
  accountant: ["financial", "operations"],
  "sales-rep": ["sales"],
  "warehouse-rep": ["inventory"],
  "po-rep": ["operations"],
  admin: ["executive", "sales", "inventory", "financial", "operations", "predictions"],
  shipment: ["operations"],
}

function DetailDialog({
  open,
  onOpenChange,
  title,
  description,
  children,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  description: string
  children: React.ReactNode
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        {children}
      </DialogContent>
    </Dialog>
  )
}

export function AnalyticsDashboard({ userRole }: AnalyticsDashboardProps) {
  const { t, formatNumber } = useI18n()

  const visibleTabs = roleVisibleTabs[userRole]
  const [activeTab, setActiveTab] = useState(visibleTabs[0] || "executive")

  const [kpiData, setKpiData] = useState<any>(null)
  const [salesData, setSalesData] = useState<any>(null)
  const [inventoryData, setInventoryData] = useState<any>(null)
  const [financialData, setFinancialData] = useState<any>(null)
  const [supplierData, setSupplierData] = useState<any>(null)
  const [predictions, setPredictions] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [predicting, setPredicting] = useState(false)

  const [aiActions, setAiActions] = useState<any>(null)
  const [generatingActions, setGeneratingActions] = useState(false)

  const [detailDialog, setDetailDialog] = useState<{
    open: boolean
    type: string
    title: string
    description: string
  }>({ open: false, type: "", title: "", description: "" })

  useEffect(() => {
    loadAllAnalytics()
  }, [])

  const loadAllAnalytics = async () => {
    setLoading(true)
    try {
      const promises = []

      if (visibleTabs.includes("executive") || visibleTabs.includes("financial")) {
        promises.push(fetch("/api/analytics/kpis").then((r) => r.json()))
      } else {
        promises.push(Promise.resolve(null))
      }

      if (visibleTabs.includes("sales")) {
        promises.push(fetch("/api/analytics/sales").then((r) => r.json()))
      } else {
        promises.push(Promise.resolve(null))
      }

      if (visibleTabs.includes("inventory") || visibleTabs.includes("operations")) {
        promises.push(fetch("/api/analytics/inventory").then((r) => r.json()))
      } else {
        promises.push(Promise.resolve(null))
      }

      if (visibleTabs.includes("financial")) {
        promises.push(fetch("/api/analytics/financial").then((r) => r.json()))
      } else {
        promises.push(Promise.resolve(null))
      }

      if (visibleTabs.includes("operations")) {
        promises.push(fetch("/api/analytics/suppliers").then((r) => r.json()))
      } else {
        promises.push(Promise.resolve(null))
      }

      const [kpis, sales, inventory, financial, suppliers] = await Promise.all(promises)

      setKpiData(kpis)
      setSalesData(sales)
      setInventoryData(inventory)
      setFinancialData(financial)
      setSupplierData(suppliers)
    } catch (error) {
      console.error("Error loading analytics:", error)
    } finally {
      setLoading(false)
    }
  }

  const generatePredictions = async (type: string) => {
    setPredicting(true)
    try {
      let historicalData: any = {}

      if (type === "demand") {
        historicalData = {
          products:
            inventoryData?.abcAnalysis?.details?.map((item: any) => ({
              productName: item.productName,
              totalSold: item.totalValue > 0 ? Math.round(item.totalValue / (item.unitPrice || 1)) : 0,
              currentStock: item.quantity || 0,
              reorderPoint: item.reorderPoint || 0,
              avgSalesPerMonth: item.totalValue > 0 ? Math.round(item.totalValue / (item.unitPrice || 1) / 3) : 0, // Estimate monthly average
            })) || [],
        }
      } else if (type === "pricing") {
        // Pass products with pricing data
        historicalData = {
          products:
            inventoryData?.abcAnalysis?.details?.map((item: any) => ({
              productName: item.productName,
              unitPrice: item.unitPrice || 0,
              lastLandedCost: (item.unitPrice || 0) * 0.7, // Estimate cost as 70% of price
              totalSold: item.totalValue > 0 ? Math.round(item.totalValue / (item.unitPrice || 1)) : 0,
              currentStock: item.quantity || 0,
            })) || [],
        }
      } else if (type === "churn") {
        historicalData = {
          customers:
            salesData?.topCustomers?.map((customer: any) => ({
              customerName: customer.customerName,
              lastOrderDate:
                customer.lastOrderDate || new Date(Date.now() - Math.random() * 90 * 24 * 60 * 60 * 1000).toISOString(),
              totalSpent: customer.totalSpent || 0,
              orderCount: customer.orderCount || 0,
              avgOrderValue: customer.avgOrderValue || 0,
            })) || [],
        }
      }

      const response = await fetch("/api/analytics/predictions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ historicalData, predictionType: type }),
      })

      const data = await response.json()
      setPredictions({ type, data })
    } catch (error) {
      console.error("Error generating predictions:", error)
    } finally {
      setPredicting(false)
    }
  }

  const generateAIActions = async (category: string) => {
    setGeneratingActions(true)
    try {
      const businessData = {
        category,
        kpis: kpiData,
        sales: salesData,
        inventory: inventoryData,
        financial: financialData,
        suppliers: supplierData,
        predictions,
      }

      const response = await fetch("/api/ai/action-recommendations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ businessData, category }),
      })

      const data = await response.json()
      setAiActions({ category, recommendations: data.recommendations })
    } catch (error) {
      console.error("Error generating AI actions:", error)
    } finally {
      setGeneratingActions(false)
    }
  }

  const openDetail = (type: string, title: string, description: string) => {
    setDetailDialog({ open: true, type, title, description })
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-96">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    )
  }

  const CHART_COLORS = [
    "rgb(99, 102, 241)",
    "rgb(16, 185, 129)",
    "rgb(245, 158, 11)",
    "rgb(239, 68, 68)",
    "rgb(139, 92, 246)",
    "rgb(236, 72, 153)",
  ]

  const renderDetailContent = () => {
    switch (detailDialog.type) {
      case "revenue":
        return (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="p-4 bg-muted/50 rounded-lg">
                <p className="text-sm text-muted-foreground">Total Revenue (EGP)</p>
                <p className="text-2xl font-bold">
                  <Money value={kpiData?.revenue?.total || 0} />
                </p>
              </div>
              <div className="p-4 bg-muted/50 rounded-lg">
                <p className="text-sm text-muted-foreground">Growth Trend</p>
                <p className="text-2xl font-bold text-emerald-500">{kpiData?.revenue?.trend || "+0%"}</p>
              </div>
            </div>
            <div className="space-y-2">
              <h4 className="font-medium">Top Revenue Sources</h4>
              {salesData?.topCustomers?.slice(0, 5).map((customer: any, idx: number) => (
                <div key={idx} className="flex items-center justify-between p-3 bg-muted/30 rounded-lg">
                  <span className="font-medium">{customer.customerName}</span>
                  <span className="text-emerald-500 font-bold">
                    <Money value={customer.totalSpent || 0} /> EGP
                  </span>
                </div>
              ))}
            </div>
          </div>
        )
      case "profit":
        return (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="p-4 bg-muted/50 rounded-lg">
                <p className="text-sm text-muted-foreground">Gross Profit (EGP)</p>
                <p className="text-2xl font-bold">
                  <Money value={kpiData?.grossProfit?.total || 0} />
                </p>
              </div>
              <div className="p-4 bg-muted/50 rounded-lg">
                <p className="text-sm text-muted-foreground">Profit Margin</p>
                <p className="text-2xl font-bold text-emerald-500">
                  {formatNumber(kpiData?.grossProfit?.margin || 0)}%
                </p>
              </div>
            </div>
            <div className="p-4 bg-blue-500/10 border border-blue-500/20 rounded-lg">
              <p className="text-sm">
                Your profit margin is {kpiData?.grossProfit?.margin > 20 ? "healthy" : "below target"}.
                {kpiData?.grossProfit?.margin < 20 && " Consider reviewing pricing or reducing costs."}
              </p>
            </div>
          </div>
        )
      case "cash":
        return (
          <div className="space-y-4">
            <div className="grid grid-cols-3 gap-4">
              <div className="p-4 bg-muted/50 rounded-lg">
                <p className="text-sm text-muted-foreground">Net Cash Position (EGP)</p>
                <p className="text-2xl font-bold">
                  <Money value={kpiData?.cashPosition?.total || 0} />
                </p>
              </div>
              <div className="p-4 bg-emerald-500/10 rounded-lg">
                <p className="text-sm text-muted-foreground">Receivables (AR) (EGP)</p>
                <p className="text-2xl font-bold text-emerald-500">
                  <Money value={kpiData?.cashPosition?.ar || 0} />
                </p>
              </div>
              <div className="p-4 bg-red-500/10 rounded-lg">
                <p className="text-sm text-muted-foreground">Payables (AP) (EGP)</p>
                <p className="text-2xl font-bold text-red-500">
                  <Money value={kpiData?.cashPosition?.ap || 0} />
                </p>
              </div>
            </div>
          </div>
        )
      case "inventory":
        return (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="p-4 bg-muted/50 rounded-lg">
                <p className="text-sm text-muted-foreground">Total Value (EGP)</p>
                <p className="text-2xl font-bold">
                  <Money value={kpiData?.inventory?.value || 0} />
                </p>
              </div>
              <div className="p-4 bg-muted/50 rounded-lg">
                <p className="text-sm text-muted-foreground">Turnover Rate</p>
                <p className="text-2xl font-bold">{formatNumber(kpiData?.inventory?.turnover || 0)}x</p>
              </div>
            </div>
            <div className="space-y-2">
              <h4 className="font-medium">ABC Classification</h4>
              <div className="grid grid-cols-3 gap-2">
                <div className="p-3 bg-emerald-500/10 rounded-lg text-center">
                  <p className="text-2xl font-bold">{inventoryData?.abcAnalysis?.aItems || 0}</p>
                  <p className="text-xs text-muted-foreground">A Items (High Value)</p>
                </div>
                <div className="p-3 bg-amber-500/10 rounded-lg text-center">
                  <p className="text-2xl font-bold">{inventoryData?.abcAnalysis?.bItems || 0}</p>
                  <p className="text-xs text-muted-foreground">B Items (Medium)</p>
                </div>
                <div className="p-3 bg-gray-500/10 rounded-lg text-center">
                  <p className="text-2xl font-bold">{inventoryData?.abcAnalysis?.cItems || 0}</p>
                  <p className="text-xs text-muted-foreground">C Items (Low Value)</p>
                </div>
              </div>
            </div>
            {inventoryData?.stockoutRisk?.highRisk > 0 && (
              <div className="p-4 bg-red-500/10 border border-red-500/20 rounded-lg">
                <p className="font-medium text-red-500">Stock-out Alert</p>
                <p className="text-sm text-muted-foreground">
                  {inventoryData.stockoutRisk.highRisk} products at high risk of running out
                </p>
              </div>
            )}
          </div>
        )
      default:
        return null
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader
        group={t("group.overview")}
        title={t("module.analytics")}
        actions={
          <Button onClick={loadAllAnalytics} variant="outline">
            <Activity className="h-4 w-4 me-2" />
            Refresh Data
          </Button>
        }
      />

      <DetailDialog
        open={detailDialog.open}
        onOpenChange={(open) => setDetailDialog((prev) => ({ ...prev, open }))}
        title={detailDialog.title}
        description={detailDialog.description}
      >
        {renderDetailContent()}
      </DetailDialog>

      <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-4">
        <TabsList
          className="grid w-full bg-muted/50"
          style={{ gridTemplateColumns: `repeat(${visibleTabs.length}, 1fr)` }}
        >
          {visibleTabs.includes("executive") && <TabsTrigger value="executive">Executive</TabsTrigger>}
          {visibleTabs.includes("sales") && <TabsTrigger value="sales">Sales</TabsTrigger>}
          {visibleTabs.includes("inventory") && <TabsTrigger value="inventory">Inventory</TabsTrigger>}
          {visibleTabs.includes("financial") && <TabsTrigger value="financial">Financial</TabsTrigger>}
          {visibleTabs.includes("operations") && <TabsTrigger value="operations">Operations</TabsTrigger>}
          {visibleTabs.includes("predictions") && <TabsTrigger value="predictions">AI Predictions</TabsTrigger>}
        </TabsList>

        {visibleTabs.includes("executive") && (
          <TabsContent value="executive" className="space-y-4">
            <KpiGrid>
              <KpiTile
                label={`${t("analytics.total-revenue")} (EGP)`}
                value={<Money value={kpiData?.revenue?.total || 0} />}
                sub={`${kpiData?.revenue?.trend || "0%"} ${t("analytics.from-last-month")}`}
                onClick={() => openDetail("revenue", t("analytics.revenue-details"), t("analytics.revenue-breakdown"))}
              />
              <KpiTile
                label={`${t("analytics.gross-profit")} (EGP)`}
                value={<Money value={kpiData?.grossProfit?.total || 0} />}
                sub={`${t("analytics.margin")}: ${formatNumber(kpiData?.grossProfit?.margin || 0)}%`}
                onClick={() => openDetail("profit", t("analytics.profit-analysis"), t("analytics.profit-details"))}
              />
              <KpiTile
                label={`${t("analytics.cash-position")} (EGP)`}
                value={<Money value={kpiData?.cashPosition?.total || 0} />}
                sub={`${t("analytics.accounts-receivable")}: ${formatNumber(kpiData?.cashPosition?.ar || 0)} | ${t("analytics.accounts-payable")}: ${formatNumber(kpiData?.cashPosition?.ap || 0)}`}
                onClick={() => openDetail("cash", t("analytics.cash-position"), t("analytics.cash-overview"))}
              />
              <KpiTile
                label={`${t("analytics.inventory-value")} (EGP)`}
                value={<Money value={kpiData?.inventory?.value || 0} />}
                sub={`${t("analytics.turnover")}: ${formatNumber(kpiData?.inventory?.turnover || 0)}x`}
                onClick={() =>
                  openDetail("inventory", t("analytics.inventory-overview"), t("analytics.inventory-details"))
                }
              />
            </KpiGrid>

            <div className="grid gap-4 md:grid-cols-2">
              <Card>
                <CardHeader>
                  <CardTitle>Key Metrics</CardTitle>
                  <CardDescription>Performance indicators at a glance</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="flex items-center justify-between p-3 bg-muted/30 rounded-lg hover:bg-muted/50 transition-colors cursor-pointer">
                    <div className="flex items-center gap-2">
                      <ShoppingCart className="h-4 w-4 text-muted-foreground" />
                      <span className="text-sm font-medium">Avg Order Value (EGP)</span>
                    </div>
                    <span className="text-sm font-bold">
                      <Money value={kpiData?.orders?.avgValue || 0} />
                    </span>
                  </div>
                  <div className="flex items-center justify-between p-3 bg-muted/30 rounded-lg hover:bg-muted/50 transition-colors cursor-pointer">
                    <div className="flex items-center gap-2">
                      <CheckCircle className="h-4 w-4 text-muted-foreground" />
                      <span className="text-sm font-medium">Order Fulfillment Rate</span>
                    </div>
                    <span className="text-sm font-bold">{formatNumber(kpiData?.orders?.fulfillmentRate || 0)}%</span>
                  </div>
                  <div className="flex items-center justify-between p-3 bg-muted/30 rounded-lg hover:bg-muted/50 transition-colors cursor-pointer">
                    <div className="flex items-center gap-2">
                      <Users className="h-4 w-4 text-muted-foreground" />
                      <span className="text-sm font-medium">Total Customers</span>
                    </div>
                    <span className="text-sm font-bold">{kpiData?.customers?.total || 0}</span>
                  </div>
                  <div className="flex items-center justify-between p-3 bg-muted/30 rounded-lg hover:bg-muted/50 transition-colors cursor-pointer">
                    <div className="flex items-center gap-2">
                      <TrendingUp className="h-4 w-4 text-emerald-500" />
                      <span className="text-sm font-medium">New Customers (This Month)</span>
                    </div>
                    <span className="text-sm font-bold">{kpiData?.customers?.newThisMonth || 0}</span>
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>Alerts & Recommendations</CardTitle>
                  <CardDescription>Action items requiring attention</CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                  {inventoryData?.stockoutRisk?.highRisk > 0 && (
                    <div className="flex items-start gap-2 p-3 bg-red-500/10 border border-red-500/20 rounded-lg cursor-pointer hover:bg-red-500/20 transition-colors">
                      <AlertTriangle className="h-4 w-4 text-red-500 mt-0.5" />
                      <div className="flex-1">
                        <p className="text-sm font-medium">Stock-out Risk</p>
                        <p className="text-xs text-muted-foreground">
                          {inventoryData.stockoutRisk.highRisk} products at high risk
                        </p>
                      </div>
                      <ArrowRight className="h-4 w-4 text-muted-foreground" />
                    </div>
                  )}
                  {kpiData?.orders?.pendingCount > 0 && (
                    <div className="flex items-start gap-2 p-3 bg-amber-500/10 border border-amber-500/20 rounded-lg cursor-pointer hover:bg-amber-500/20 transition-colors">
                      <AlertTriangle className="h-4 w-4 text-amber-500 mt-0.5" />
                      <div className="flex-1">
                        <p className="text-sm font-medium">Pending Orders</p>
                        <p className="text-xs text-muted-foreground">
                          {kpiData.orders.pendingCount} orders awaiting approval
                        </p>
                      </div>
                      <ArrowRight className="h-4 w-4 text-muted-foreground" />
                    </div>
                  )}
                  {inventoryData?.slowMoving?.length > 0 && (
                    <div className="flex items-start gap-2 p-3 bg-indigo-500/10 border border-indigo-500/20 rounded-lg cursor-pointer hover:bg-indigo-500/20 transition-colors">
                      <Package className="h-4 w-4 text-indigo-500 mt-0.5" />
                      <div className="flex-1">
                        <p className="text-sm font-medium">Slow-Moving Inventory</p>
                        <p className="text-xs text-muted-foreground">
                          {inventoryData.slowMoving.length} items with low turnover
                        </p>
                      </div>
                      <ArrowRight className="h-4 w-4 text-muted-foreground" />
                    </div>
                  )}
                  {!inventoryData?.stockoutRisk?.highRisk &&
                    !kpiData?.orders?.pendingCount &&
                    !inventoryData?.slowMoving?.length && (
                      <div className="flex items-center justify-center p-8 text-muted-foreground">
                        <CheckCircle className="h-5 w-5 me-2 text-emerald-500" />
                        All systems operating normally
                      </div>
                    )}
                </CardContent>
              </Card>
            </div>
          </TabsContent>
        )}

        {/* Sales Analytics */}
        {visibleTabs.includes("sales") && (
          <TabsContent value="sales" className="space-y-4">
            <div className="grid gap-4 md:grid-cols-2">
              <Card>
                <CardHeader>
                  <CardTitle>Top Customers by Revenue</CardTitle>
                  <CardDescription>Customer lifetime value leaders</CardDescription>
                </CardHeader>
                <CardContent>
                  {salesData?.topCustomers?.length > 0 ? (
                    <ResponsiveContainer width="100%" height={300}>
                      <BarChart data={salesData?.topCustomers?.slice(0, 5) || []}>
                        <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.1)" />
                        <XAxis
                          dataKey="customerName"
                          stroke="rgb(161, 161, 170)"
                          tick={{ fill: "rgb(161, 161, 170)", fontSize: 12 }}
                        />
                        <YAxis stroke="rgb(161, 161, 170)" tick={{ fill: "rgb(161, 161, 170)" }} />
                        <Tooltip
                          contentStyle={{ backgroundColor: "rgb(24, 24, 27)", border: "1px solid rgb(39, 39, 42)" }}
                          formatter={(value: any) => [`EGP ${value.toLocaleString()}`, "Revenue"]}
                        />
                        <Bar dataKey="totalSpent" fill="rgb(99, 102, 241)" radius={[8, 8, 0, 0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  ) : (
                    <div className="flex items-center justify-center h-[300px] text-muted-foreground">
                      No sales data available
                    </div>
                  )}
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>Sales Funnel</CardTitle>
                  <CardDescription>Order conversion pipeline</CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="space-y-4">
                    <div className="p-3 bg-muted/30 rounded-lg">
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-sm font-medium flex items-center gap-2">
                          <div className="w-3 h-3 rounded-full bg-amber-500" />
                          Pending
                        </span>
                        <span className="text-sm font-bold">{salesData?.funnel?.pending || 0}</span>
                      </div>
                      <div className="w-full bg-secondary rounded-full h-2">
                        <div
                          className="bg-amber-500 h-2 rounded-full transition-all"
                          style={{
                            width: `${((salesData?.funnel?.pending || 0) / Math.max((salesData?.funnel?.pending || 0) + (salesData?.funnel?.approved || 0) + (salesData?.funnel?.shipped || 0), 1)) * 100}%`,
                          }}
                        />
                      </div>
                    </div>
                    <div className="p-3 bg-muted/30 rounded-lg">
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-sm font-medium flex items-center gap-2">
                          <div className="w-3 h-3 rounded-full bg-indigo-500" />
                          Approved
                        </span>
                        <span className="text-sm font-bold">{salesData?.funnel?.approved || 0}</span>
                      </div>
                      <div className="w-full bg-secondary rounded-full h-2">
                        <div
                          className="bg-indigo-500 h-2 rounded-full transition-all"
                          style={{
                            width: `${((salesData?.funnel?.approved || 0) / Math.max((salesData?.funnel?.pending || 0) + (salesData?.funnel?.approved || 0) + (salesData?.funnel?.shipped || 0), 1)) * 100}%`,
                          }}
                        />
                      </div>
                    </div>
                    <div className="p-3 bg-muted/30 rounded-lg">
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-sm font-medium flex items-center gap-2">
                          <div className="w-3 h-3 rounded-full bg-emerald-500" />
                          Shipped
                        </span>
                        <span className="text-sm font-bold">{salesData?.funnel?.shipped || 0}</span>
                      </div>
                      <div className="w-full bg-secondary rounded-full h-2">
                        <div
                          className="bg-emerald-500 h-2 rounded-full transition-all"
                          style={{
                            width: `${((salesData?.funnel?.shipped || 0) / Math.max((salesData?.funnel?.pending || 0) + (salesData?.funnel?.approved || 0) + (salesData?.funnel?.shipped || 0), 1)) * 100}%`,
                          }}
                        />
                      </div>
                    </div>
                    <div className="pt-4 border-t border-border">
                      <div className="flex items-center justify-between p-3 bg-emerald-500/10 rounded-lg">
                        <span className="text-sm font-medium">Conversion Rate</span>
                        <span className="text-xl font-bold text-emerald-500">
                          {salesData?.funnel?.conversionRate?.toFixed(1) || 0}%
                        </span>
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </div>

            <Card>
              <CardHeader>
                <CardTitle>Product Affinity Analysis</CardTitle>
                <CardDescription>Products frequently purchased together</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="space-y-2">
                  {salesData?.productAffinity?.length > 0 ? (
                    salesData.productAffinity.map((pair: any, idx: number) => (
                      <div
                        key={idx}
                        className="flex items-center justify-between p-3 bg-muted/30 rounded-lg hover:bg-muted/50 transition-colors"
                      >
                        <div className="flex items-center gap-2">
                          <Badge variant="outline">{pair.product1}</Badge>
                          <span className="text-muted-foreground">+</span>
                          <Badge variant="outline">{pair.product2}</Badge>
                        </div>
                        <Badge>{pair.count} orders</Badge>
                      </div>
                    ))
                  ) : (
                    <div className="flex items-center justify-center p-8 text-muted-foreground">
                      Not enough data for affinity analysis
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
          </TabsContent>
        )}

        {/* Inventory Analytics */}
        {visibleTabs.includes("inventory") && (
          <TabsContent value="inventory" className="space-y-4">
            <KpiGrid>
              <KpiTile
                label="A Items (High Value)"
                value={inventoryData?.abcAnalysis?.aItems || 0}
                sub="80% of inventory value"
              />
              <KpiTile
                label="B Items (Medium)"
                value={inventoryData?.abcAnalysis?.bItems || 0}
                sub="15% of inventory value"
              />
              <KpiTile
                label="C Items (Low Value)"
                value={inventoryData?.abcAnalysis?.cItems || 0}
                sub="5% of inventory value"
              />
            </KpiGrid>

            <div className="grid gap-4 md:grid-cols-2">
              <Card>
                <CardHeader>
                  <CardTitle>Stock-out Risk Analysis</CardTitle>
                  <CardDescription>Items at risk of running out</CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="space-y-3">
                    {inventoryData?.stockoutRisk?.details?.length > 0 ? (
                      inventoryData.stockoutRisk.details.map((item: any, idx: number) => (
                        <div key={idx} className="p-3 bg-red-500/10 border border-red-500/20 rounded-lg">
                          <div className="flex items-center justify-between mb-2">
                            <span className="font-medium">{item.productName}</span>
                            <Badge variant="destructive">{item.riskLevel} risk</Badge>
                          </div>
                          <div className="grid grid-cols-3 gap-2 text-xs text-muted-foreground">
                            <div>Stock: {item.currentStock}</div>
                            <div>Velocity: {item.dailyVelocity?.toFixed(1)}/day</div>
                            <div>Days left: {item.daysUntilStockout?.toFixed(0)}</div>
                          </div>
                        </div>
                      ))
                    ) : (
                      <div className="flex items-center justify-center p-8 text-muted-foreground">
                        <CheckCircle className="h-5 w-5 me-2 text-emerald-500" />
                        No high-risk items
                      </div>
                    )}
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>Slow-Moving Inventory</CardTitle>
                  <CardDescription>Items with low turnover rate</CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="space-y-2">
                    {inventoryData?.slowMoving?.length > 0 ? (
                      inventoryData.slowMoving.slice(0, 5).map((item: any, idx: number) => (
                        <div key={idx} className="flex items-center justify-between p-3 bg-muted/30 rounded-lg">
                          <div>
                            <p className="font-medium">{item.productName}</p>
                            <p className="text-xs text-muted-foreground">Stock: {item.quantity}</p>
                          </div>
                          <Badge variant="outline">
                            <Money value={item.totalValue || 0} /> EGP
                          </Badge>
                        </div>
                      ))
                    ) : (
                      <div className="flex items-center justify-center p-8 text-muted-foreground">
                        No slow-moving items detected
                      </div>
                    )}
                  </div>
                </CardContent>
              </Card>
            </div>
          </TabsContent>
        )}

        {/* Financial Analytics */}
        {visibleTabs.includes("financial") && (
          <TabsContent value="financial" className="space-y-4">
            <div className="grid gap-4 md:grid-cols-2">
              <Card>
                <CardHeader>
                  <CardTitle>Cash Flow Overview</CardTitle>
                  <CardDescription>Receivables vs Payables</CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="space-y-4">
                    <div className="p-4 bg-emerald-500/10 rounded-lg">
                      <div className="flex items-center justify-between">
                        <span className="text-sm font-medium">Accounts Receivable (EGP)</span>
                        <span className="text-xl font-bold text-emerald-500">
                          <Money value={kpiData?.cashPosition?.ar || 0} />
                        </span>
                      </div>
                      <p className="text-xs text-muted-foreground mt-1">Money owed to you</p>
                    </div>
                    <div className="p-4 bg-red-500/10 rounded-lg">
                      <div className="flex items-center justify-between">
                        <span className="text-sm font-medium">Accounts Payable (EGP)</span>
                        <span className="text-xl font-bold text-red-500">
                          <Money value={kpiData?.cashPosition?.ap || 0} />
                        </span>
                      </div>
                      <p className="text-xs text-muted-foreground mt-1">Money you owe</p>
                    </div>
                    <div className="p-4 bg-primary/10 rounded-lg border border-primary/20">
                      <div className="flex items-center justify-between">
                        <span className="text-sm font-medium">Net Position (EGP)</span>
                        <span
                          className={`text-xl font-bold ${(kpiData?.cashPosition?.total || 0) >= 0 ? "text-emerald-500" : "text-red-500"}`}
                        >
                          <Money value={kpiData?.cashPosition?.total || 0} />
                        </span>
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>Profitability Metrics</CardTitle>
                  <CardDescription>Revenue and margin analysis</CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="space-y-4">
                    <div className="flex items-center justify-between p-3 bg-muted/30 rounded-lg">
                      <span className="text-sm font-medium">Total Revenue (EGP)</span>
                      <span className="font-bold">
                        <Money value={kpiData?.revenue?.total || 0} />
                      </span>
                    </div>
                    <div className="flex items-center justify-between p-3 bg-muted/30 rounded-lg">
                      <span className="text-sm font-medium">Gross Profit (EGP)</span>
                      <span className="font-bold text-emerald-500">
                        <Money value={kpiData?.grossProfit?.total || 0} />
                      </span>
                    </div>
                    <div className="flex items-center justify-between p-3 bg-muted/30 rounded-lg">
                      <span className="text-sm font-medium">Gross Margin</span>
                      <span className="font-bold">{formatNumber(kpiData?.grossProfit?.margin || 0)}%</span>
                    </div>
                    <div className="p-4 rounded-lg bg-gradient-to-r from-primary/10 to-emerald-500/10">
                      <p className="text-sm">
                        {kpiData?.grossProfit?.margin >= 25
                          ? "Excellent margin! Your pricing strategy is working well."
                          : kpiData?.grossProfit?.margin >= 15
                            ? "Good margin. Consider optimizing high-volume products."
                            : "Margin needs improvement. Review pricing and costs."}
                      </p>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </div>
          </TabsContent>
        )}

        {/* Operations Analytics */}
        {visibleTabs.includes("operations") && (
          <TabsContent value="operations" className="space-y-4">
            <KpiGrid>
              <KpiTile label="Active Suppliers" value={supplierData?.scorecard?.length || 0} sub="Verified partners" />
              <KpiTile
                label="Supplier Performance"
                value={
                  <>
                    {supplierData?.scorecard?.length > 0
                      ? Math.round(
                          supplierData.scorecard.reduce((sum: number, s: any) => sum + s.overallScore, 0) /
                            supplierData.scorecard.length,
                        )
                      : 0}
                    %
                  </>
                }
                sub="Average quality score"
              />
              <KpiTile
                label="On-Time Delivery"
                value={
                  <>
                    {supplierData?.scorecard?.length > 0
                      ? Math.round(
                          supplierData.scorecard.reduce((sum: number, s: any) => sum + s.onTimeRate, 0) /
                            supplierData.scorecard.length,
                        )
                      : 0}
                    %
                  </>
                }
                sub="Delivery reliability"
              />
              <KpiTile
                label="Total Procurement (EGP)"
                value={
                  <Money
                    value={
                      supplierData?.scorecard?.reduce((sum: number, s: any) => sum + (s.totalPurchaseValue || 0), 0) ||
                      0
                    }
                  />
                }
                sub="Total purchase value"
              />
            </KpiGrid>

            <Card>
              <CardHeader>
                <CardTitle>Inventory Health Dashboard</CardTitle>
                <CardDescription>Real-time stock levels and reorder alerts</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="grid gap-4 md:grid-cols-3 mb-6">
                  <div className="p-4 bg-emerald-500/10 rounded-lg border border-emerald-500/20">
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-sm font-medium">Optimal Stock</span>
                      <CheckCircle className="h-4 w-4 text-emerald-500" />
                    </div>
                    <div className="text-2xl font-bold">
                      {inventoryData?.abcAnalysis?.details?.filter(
                        (item: any) => item.quantity > (item.reorderPoint || 0),
                      )?.length || 0}
                    </div>
                    <p className="text-xs text-muted-foreground mt-1">Products well-stocked</p>
                  </div>

                  <div className="p-4 bg-amber-500/10 rounded-lg border border-amber-500/20">
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-sm font-medium">Low Stock Alert</span>
                      <AlertTriangle className="h-4 w-4 text-amber-500" />
                    </div>
                    <div className="text-2xl font-bold text-amber-500">
                      {inventoryData?.stockoutRisk?.mediumRisk || 0}
                    </div>
                    <p className="text-xs text-muted-foreground mt-1">Products need reorder soon</p>
                  </div>

                  <div className="p-4 bg-red-500/10 rounded-lg border border-red-500/20">
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-sm font-medium">Critical Stock</span>
                      <AlertTriangle className="h-4 w-4 text-red-500" />
                    </div>
                    <div className="text-2xl font-bold text-red-500">{inventoryData?.stockoutRisk?.highRisk || 0}</div>
                    <p className="text-xs text-muted-foreground mt-1">Products at risk of stockout</p>
                  </div>
                </div>

                {inventoryData?.abcAnalysis?.details && inventoryData.abcAnalysis.details.length > 0 && (
                  <div className="space-y-3">
                    <h4 className="font-medium text-sm">Stock Value by Category</h4>
                    <ResponsiveContainer width="100%" height={200}>
                      <BarChart
                        data={inventoryData.abcAnalysis.details
                          .reduce((acc: any[], item: any) => {
                            const category = item.category || "Uncategorized"
                            const existing = acc.find((a) => a.category === category)
                            if (existing) {
                              existing.value += item.totalValue || 0
                              existing.quantity += item.quantity || 0
                            } else {
                              acc.push({
                                category,
                                value: item.totalValue || 0,
                                quantity: item.quantity || 0,
                              })
                            }
                            return acc
                          }, [])
                          .slice(0, 6)}
                      >
                        <CartesianGrid strokeDasharray="3 3" />
                        <XAxis dataKey="category" />
                        <YAxis />
                        <Tooltip formatter={(value: any) => `EGP ${value.toLocaleString()}`} />
                        <Bar dataKey="value" fill={CHART_COLORS[0]} name="Total Value (EGP)" />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Supplier Performance Scorecard</CardTitle>
                <CardDescription>Quality, delivery, and reliability metrics</CardDescription>
              </CardHeader>
              <CardContent>
                {supplierData?.scorecard && supplierData.scorecard.length > 0 ? (
                  <div className="space-y-3">
                    {supplierData.scorecard.slice(0, 10).map((supplier: any, idx: number) => (
                      <div
                        key={idx}
                        className="p-4 bg-muted/50 rounded-lg hover:bg-muted/70 transition-colors cursor-pointer border"
                      >
                        <div className="flex items-center justify-between mb-3">
                          <h4 className="font-medium">{supplier.supplierName}</h4>
                          <Badge
                            variant={
                              supplier.overallScore >= 90
                                ? "default"
                                : supplier.overallScore >= 70
                                  ? "secondary"
                                  : "destructive"
                            }
                          >
                            {Math.round(supplier.overallScore)}% Overall Score
                          </Badge>
                        </div>
                        <div className="grid grid-cols-4 gap-4 text-sm">
                          <div>
                            <p className="text-muted-foreground">On-Time Rate</p>
                            <p className="font-bold">{Math.round(supplier.onTimeRate)}%</p>
                          </div>
                          <div>
                            <p className="text-muted-foreground">Avg Lead Time</p>
                            <p className="font-bold">{Math.round(supplier.avgLeadTime)} days</p>
                          </div>
                          <div>
                            <p className="text-muted-foreground">Total Orders</p>
                            <p className="font-bold">{supplier.orderCount}</p>
                          </div>
                          <div>
                            <p className="text-muted-foreground">Purchase Value (EGP)</p>
                            <p className="font-bold">
                              <Money value={supplier.totalPurchaseValue || 0} />
                            </p>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="flex items-center justify-center p-8 text-muted-foreground">
                    No supplier data available
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        )}

        {/* AI Predictions */}
        {visibleTabs.includes("predictions") && (
          <TabsContent value="predictions" className="space-y-4">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h2 className="text-2xl font-bold">AI-Powered Predictions</h2>
                <p className="text-sm text-muted-foreground">Generate forecasts and analyze business trends</p>
              </div>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="default" className="gap-2" disabled={generatingActions}>
                    {generatingActions ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Lightbulb className="h-4 w-4" />
                    )}
                    Actions to Take
                    <ChevronDown className="h-4 w-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-56">
                  <DropdownMenuLabel>Get AI Recommendations For</DropdownMenuLabel>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onClick={() => generateAIActions("sales")} className="cursor-pointer">
                    <ShoppingCart className="h-4 w-4 me-2" />
                    Sales Strategy
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => generateAIActions("inventory")} className="cursor-pointer">
                    <Package className="h-4 w-4 me-2" />
                    Inventory Management
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => generateAIActions("financial")} className="cursor-pointer">
                    <DollarSign className="h-4 w-4 me-2" />
                    Financial Optimization
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => generateAIActions("operations")} className="cursor-pointer">
                    <Building2 className="h-4 w-4 me-2" />
                    Operations Efficiency
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>

            {aiActions && (
              <Card className="border-primary/50 bg-primary/5">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Lightbulb className="h-5 w-5 text-primary" />
                    AI Recommendations: {aiActions.category.charAt(0).toUpperCase() + aiActions.category.slice(1)}
                  </CardTitle>
                  <CardDescription>Actionable insights for best business outcomes</CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="space-y-3">
                    {aiActions.recommendations?.map((rec: any, idx: number) => (
                      <div
                        key={idx}
                        className="p-4 bg-background border border-primary/20 rounded-lg hover:border-primary/40 transition-colors"
                      >
                        <div className="flex items-start gap-3">
                          <div className="flex-shrink-0 w-6 h-6 rounded-full bg-primary/20 flex items-center justify-center text-xs font-bold text-primary">
                            {idx + 1}
                          </div>
                          <div className="flex-1">
                            <p className="font-medium mb-1">{rec.title}</p>
                            <p className="text-sm text-muted-foreground mb-2">{rec.description}</p>
                            <div className="flex items-center gap-2">
                              <Badge variant="outline" className="text-xs">
                                {rec.priority} Priority
                              </Badge>
                              <Badge variant="secondary" className="text-xs">
                                Impact: {rec.expectedImpact}
                              </Badge>
                            </div>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            )}

            <div className="grid gap-4 md:grid-cols-3">
              <Card
                className="cursor-pointer hover:border-primary hover:shadow-lg transition-all"
                onClick={() => !predicting && generatePredictions("demand")}
              >
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <BarChart3 className="h-5 w-5 text-primary" />
                    Demand Forecasting
                  </CardTitle>
                  <CardDescription>Predict next month's demand by product using historical sales data</CardDescription>
                </CardHeader>
                <CardContent>
                  <Button variant="outline" className="w-full bg-transparent" disabled={predicting}>
                    {predicting && predictions?.type === "demand" ? (
                      <Loader2 className="h-4 w-4 animate-spin me-2" />
                    ) : null}
                    Generate Forecast
                  </Button>
                </CardContent>
              </Card>

              <Card
                className="cursor-pointer hover:border-emerald-500 hover:shadow-lg transition-all"
                onClick={() => !predicting && generatePredictions("pricing")}
              >
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <DollarSign className="h-5 w-5 text-emerald-500" />
                    Dynamic Pricing
                  </CardTitle>
                  <CardDescription>Optimize prices based on market trends and inventory levels</CardDescription>
                </CardHeader>
                <CardContent>
                  <Button variant="outline" className="w-full bg-transparent" disabled={predicting}>
                    {predicting && predictions?.type === "pricing" ? (
                      <Loader2 className="h-4 w-4 animate-spin me-2" />
                    ) : null}
                    Get Recommendations
                  </Button>
                </CardContent>
              </Card>

              <Card
                className="cursor-pointer hover:border-amber-500 hover:shadow-lg transition-all"
                onClick={() => !predicting && generatePredictions("churn")}
              >
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <AlertTriangle className="h-5 w-5 text-amber-500" />
                    Churn Prediction
                  </CardTitle>
                  <CardDescription>Identify at-risk customers and prevent revenue loss</CardDescription>
                </CardHeader>
                <CardContent>
                  <Button variant="outline" className="w-full bg-transparent" disabled={predicting}>
                    {predicting && predictions?.type === "churn" ? (
                      <Loader2 className="h-4 w-4 animate-spin me-2" />
                    ) : null}
                    Analyze Churn Risk
                  </Button>
                </CardContent>
              </Card>
            </div>

            {predictions && (
              <Card>
                <CardHeader>
                  <CardTitle>
                    {predictions.type === "demand"
                      ? "📊 Demand Forecast Results"
                      : predictions.type === "pricing"
                        ? "💰 Pricing Recommendations"
                        : "⚠️ Churn Risk Analysis"}
                  </CardTitle>
                  <CardDescription>
                    {predictions.type === "demand"
                      ? "Predicted demand for the next 30 days based on historical sales patterns"
                      : predictions.type === "pricing"
                        ? "Suggested price adjustments to optimize profit margins"
                        : "Customers requiring immediate attention to prevent churn"}
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="space-y-3">
                    {predictions.type === "demand" &&
                      (predictions.data?.predictions?.length > 0 ? (
                        <>
                          <div className="grid grid-cols-3 gap-4 mb-4 p-4 bg-muted/50 rounded-lg">
                            <div>
                              <p className="text-sm text-muted-foreground">Total Forecasted Demand</p>
                              <p className="text-2xl font-bold">
                                {predictions.data.predictions.reduce(
                                  (sum: number, p: any) => sum + p.predictedDemand,
                                  0,
                                )}{" "}
                                units
                              </p>
                            </div>
                            <div>
                              <p className="text-sm text-muted-foreground">High Confidence Items</p>
                              <p className="text-2xl font-bold text-emerald-500">
                                {predictions.data.predictions.filter((p: any) => p.confidence === "high").length}
                              </p>
                            </div>
                            <div>
                              <p className="text-sm text-muted-foreground">Requires Restocking</p>
                              <p className="text-2xl font-bold text-amber-500">
                                {
                                  predictions.data.predictions.filter(
                                    (p: any) => p.predictedDemand > (p.currentStock || 0),
                                  ).length
                                }
                              </p>
                            </div>
                          </div>
                          {predictions.data.predictions.map((pred: any, idx: number) => (
                            <div
                              key={idx}
                              className="flex items-center justify-between p-4 bg-muted/50 rounded-lg border"
                            >
                              <div className="flex-1">
                                <p className="text-sm font-medium mb-1">{pred.productName}</p>
                                <div className="flex items-center gap-2">
                                  <Badge
                                    variant={
                                      pred.confidence === "high"
                                        ? "default"
                                        : pred.confidence === "medium"
                                          ? "secondary"
                                          : "outline"
                                    }
                                  >
                                    {pred.confidence} confidence
                                  </Badge>
                                  {pred.predictedDemand > (pred.currentStock || 0) && (
                                    <Badge variant="destructive">Restock Needed</Badge>
                                  )}
                                </div>
                              </div>
                              <div className="text-end">
                                <p className="text-xs text-muted-foreground">Predicted Demand</p>
                                <span className="text-lg font-bold">{pred.predictedDemand} units</span>
                                <p className="text-xs text-muted-foreground mt-1">
                                  Current: {pred.currentStock || 0} units
                                </p>
                              </div>
                            </div>
                          ))}
                        </>
                      ) : (
                        <div className="text-center py-8 text-muted-foreground">No demand predictions available</div>
                      ))}
                    {predictions.type === "pricing" &&
                      (predictions.data?.recommendations?.length > 0 ? (
                        predictions.data.recommendations.map((rec: any, idx: number) => (
                          <div key={idx} className="p-4 bg-muted/50 rounded-lg border">
                            <div className="flex items-center justify-between mb-2">
                              <p className="text-sm font-medium">{rec.productName}</p>
                              <div className="text-end">
                                <span className="text-sm line-through text-muted-foreground">
                                  <Money value={rec.currentPrice} /> EGP
                                </span>
                                <span className="ms-2 text-sm font-bold text-emerald-500">
                                  <Money value={rec.suggestedPrice} /> EGP
                                </span>
                                <Badge variant="outline" className="ms-2">
                                  {(((rec.suggestedPrice - rec.currentPrice) / rec.currentPrice) * 100).toFixed(1)}%
                                </Badge>
                              </div>
                            </div>
                            <p className="text-xs text-muted-foreground">{rec.reasoning}</p>
                          </div>
                        ))
                      ) : (
                        <div className="text-center py-8 text-muted-foreground">
                          No pricing recommendations available
                        </div>
                      ))}
                    {predictions.type === "churn" &&
                      (predictions.data?.atRisk?.length > 0 ? (
                        <>
                          <div className="grid grid-cols-3 gap-4 mb-4 p-4 bg-red-500/10 rounded-lg border border-red-500/20">
                            <div>
                              <p className="text-sm text-muted-foreground">High Risk Customers</p>
                              <p className="text-2xl font-bold text-red-500">
                                {predictions.data.atRisk.filter((c: any) => c.riskLevel === "high").length}
                              </p>
                            </div>
                            <div>
                              <p className="text-sm text-muted-foreground">Potential Revenue at Risk (EGP)</p>
                              <p className="text-2xl font-bold">
                                <Money
                                  value={predictions.data.atRisk.reduce(
                                    (sum: number, c: any) => sum + (c.totalSpent || 0),
                                    0,
                                  )}
                                />
                              </p>
                            </div>
                            <div>
                              <p className="text-sm text-muted-foreground">Action Required</p>
                              <p className="text-2xl font-bold text-amber-500">
                                {predictions.data.atRisk.filter((c: any) => c.lastOrderDays > 60).length}
                              </p>
                            </div>
                          </div>
                          {predictions.data.atRisk.map((cust: any, idx: number) => (
                            <div key={idx} className="p-4 bg-muted/50 rounded-lg border">
                              <div className="flex items-center justify-between mb-2">
                                <div>
                                  <p className="text-sm font-medium">{cust.customerName}</p>
                                  <p className="text-xs text-muted-foreground">
                                    Lifetime Value: <Money value={cust.totalSpent || 0} /> EGP
                                  </p>
                                </div>
                                <Badge
                                  variant={
                                    cust.riskLevel === "high"
                                      ? "destructive"
                                      : cust.riskLevel === "medium"
                                        ? "secondary"
                                        : "outline"
                                  }
                                >
                                  {cust.riskLevel} risk
                                </Badge>
                              </div>
                              <div className="flex items-center justify-between">
                                <p className="text-xs text-muted-foreground">
                                  Last order: <span className="font-medium">{cust.lastOrderDays} days ago</span>
                                </p>
                                <p className="text-xs text-muted-foreground">{cust.reasoning}</p>
                              </div>
                            </div>
                          ))}
                        </>
                      ) : (
                        <div className="text-center py-8 text-muted-foreground">
                          <CheckCircle className="h-8 w-8 mx-auto mb-2 text-emerald-500" />
                          <p className="font-medium">No at-risk customers detected</p>
                          <p className="text-sm">All customers are engaging regularly with your business</p>
                        </div>
                      ))}
                  </div>
                </CardContent>
              </Card>
            )}
          </TabsContent>
        )}
      </Tabs>
    </div>
  )
}
