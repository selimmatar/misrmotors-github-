"use client"

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import dynamic from "next/dynamic"
import { useAppContext } from "@/lib/app-context"
import { analyzeFinancials } from "@/lib/ai-utils"
import { useI18n } from "@/lib/i18n-context"
import { fill } from "@/lib/i18n-format"
import type { User } from "@/lib/types"
import { useState, useEffect } from "react"
import { Sparkles, TrendingUp, AlertTriangle, CheckCircle2 } from "lucide-react"
import { PageHeader } from "@/components/erp/page-header"
import { KpiGrid, KpiTile } from "@/components/erp/kpi-tile"
import { Money } from "@/components/erp/money"
import { StatusBadge } from "@/components/erp/status-badge"
import { formatDate, statusLabel } from "@/lib/format"

const BarChart = dynamic(() => import("recharts").then((mod) => mod.BarChart), { ssr: false })
const Bar = dynamic(() => import("recharts").then((mod) => mod.Bar), { ssr: false })
const LineChart = dynamic(() => import("recharts").then((mod) => mod.LineChart), { ssr: false })
const Line = dynamic(() => import("recharts").then((mod) => mod.Line), { ssr: false })
const XAxis = dynamic(() => import("recharts").then((mod) => mod.XAxis), { ssr: false })
const YAxis = dynamic(() => import("recharts").then((mod) => mod.YAxis), { ssr: false })
const CartesianGrid = dynamic(() => import("recharts").then((mod) => mod.CartesianGrid), { ssr: false })
const Tooltip = dynamic(() => import("recharts").then((mod) => mod.Tooltip), { ssr: false })
const Legend = dynamic(() => import("recharts").then((mod) => mod.Legend), { ssr: false })
const ResponsiveContainer = dynamic(() => import("recharts").then((mod) => mod.ResponsiveContainer), { ssr: false })
const PieChart = dynamic(() => import("recharts").then((mod) => mod.PieChart), { ssr: false })
const Pie = dynamic(() => import("recharts").then((mod) => mod.Pie), { ssr: false })
const Cell = dynamic(() => import("recharts").then((mod) => mod.Cell), { ssr: false })

interface FinancialDashboardProps {
  user: User
}

export function FinancialDashboard({ user }: FinancialDashboardProps) {
  const { t, formatNumber, formatCurrency, language } = useI18n()
  const {
    inventory,
    purchaseOrders,
    salesOrders,
    supplierInvoices,
    customerInvoices,
    prepaidBalance,
    products,
    customers,
  } = useAppContext()

  const [aiAnalysis, setAiAnalysis] = useState<any>(null)
  const [isAnalyzing, setIsAnalyzing] = useState(false)
  const [showAiInsights, setShowAiInsights] = useState(false)
  const [selectedMetric, setSelectedMetric] = useState<string | null>(null)
  const [showDetailDialog, setShowDetailDialog] = useState(false)
  const [detailDialogData, setDetailDialogData] = useState<any>(null)
  const [rescheduleRequests, setRescheduleRequests] = useState<any[]>([])
  const [loadingReschedule, setLoadingReschedule] = useState(false)

  // Fetch reschedule requests for CEO approval
  useEffect(() => {
    const fetchRescheduleRequests = async () => {
      try {
        const response = await fetch("/api/reschedule-requests")
        if (response.ok) {
          const data = await response.json()
          setRescheduleRequests(data.filter((r: any) => r.status === "pending"))
        }
      } catch (error) {
        console.error("Failed to fetch reschedule requests:", error)
      }
    }
    fetchRescheduleRequests()
  }, [])

  const handleApproveReschedule = async (requestId: string) => {
    setLoadingReschedule(true)
    try {
      const response = await fetch("/api/reschedule-requests", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: requestId, status: "approved", reviewedBy: user.name }),
      })
      if (response.ok) {
        setRescheduleRequests((prev) => prev.filter((r) => r.id !== requestId))
        alert(t("financial.reschedule-approved"))
      }
    } catch (error) {
      alert(t("financial.failed-to-approve-request"))
    } finally {
      setLoadingReschedule(false)
    }
  }

  const handleRejectReschedule = async (requestId: string) => {
    const reason = prompt(t("financial.reason-for-rejection-prompt"))
    if (!reason) return
    
    setLoadingReschedule(true)
    try {
      const response = await fetch("/api/reschedule-requests", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: requestId, status: "rejected", reviewedBy: user.name, rejectionReason: reason }),
      })
      if (response.ok) {
        setRescheduleRequests((prev) => prev.filter((r) => r.id !== requestId))
        alert(t("financial.reschedule-rejected"))
      }
    } catch (error) {
      alert(t("financial.failed-to-reject-request"))
    } finally {
      setLoadingReschedule(false)
    }
  }

  const totalInventoryValue = inventory.reduce((sum, item) => {
    const product = products.find((p) => String(p.id) === String(item.productId))
    const unitPrice = product?.unitPrice || 0
    return sum + item.quantity * unitPrice
  }, 0)

  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const todayString = today.toISOString().split("T")[0]

  const overdueSupplierInvoices = supplierInvoices.filter((inv) => {
    if (inv.status === "paid") return false

    const dueDate = new Date(inv.dueDate)
    if (inv.installmentMonths > 1) {
      dueDate.setMonth(dueDate.getMonth() + (inv.monthsPaid || 0))
    }
    const effectiveDueDateString = dueDate.toISOString().split("T")[0]

    return effectiveDueDateString < todayString
  })

  const totalAccountsPayable = overdueSupplierInvoices.reduce((sum, inv) => sum + (inv.amount || 0), 0)

  const overdueCustomerInvoices = customerInvoices.filter((inv) => {
    if (inv.status === "paid") return false

    const dueDate = new Date(inv.dueDate)
    if (inv.installmentMonths > 1) {
      dueDate.setMonth(dueDate.getMonth() + (inv.monthsPaid || 0))
    }
    const effectiveDueDateString = dueDate.toISOString().split("T")[0]

    const balance = (inv.amount || 0) - (inv.collectedAmount || 0)
    return effectiveDueDateString < todayString && balance > 0
  })

  const totalAccountsReceivable = overdueCustomerInvoices.reduce((sum, inv) => {
    const balance = (inv.amount || 0) - (inv.collectedAmount || 0)
    return sum + balance
  }, 0)

  const installmentSupplierInvoices = supplierInvoices.filter((inv) => {
    const po = purchaseOrders.find((p) => String(p.id) === String(inv.poId))
    return po?.paymentMethod === "installment"
  })

  const installmentCustomerInvoices = customerInvoices.filter((inv) => {
    const so = salesOrders.find((s) => String(s.id) === String(inv.soId))
    return so?.paymentMethod === "installment"
  })

  const totalRevenue = customerInvoices.reduce((sum, inv) => sum + (inv.amount || 0), 0)
  const totalExpenses = supplierInvoices.reduce((sum, inv) => sum + (inv.amount || 0), 0)
  const grossProfit = totalRevenue - totalExpenses
  const profitMargin = totalExpenses > 0 ? ((grossProfit / totalExpenses) * 100).toFixed(2) : "N/A"
  const inventoryValue = totalInventoryValue

  const inventoryDistribution = inventory.map((item) => {
    const product = products.find((p) => String(p.id) === String(item.productId))
    const unitPrice = product?.unitPrice || 0
    return {
      name: item.productName,
      value: item.quantity * unitPrice,
    }
  })

  const monthlyData = Array.from({ length: 6 }, (_, i) => {
    const date = new Date()
    date.setMonth(date.getMonth() - (5 - i))
    const month = date.toLocaleString("default", { month: "short" })

    const monthRevenue = customerInvoices
      .filter((inv) => {
        const invDate = new Date(inv.date)
        return invDate.getMonth() === date.getMonth() && invDate.getFullYear() === date.getFullYear()
      })
      .reduce((sum, inv) => sum + (inv.amount || 0), 0)

    const monthExpenses = supplierInvoices
      .filter((inv) => {
        const invDate = new Date(inv.date)
        return invDate.getMonth() === date.getMonth() && invDate.getFullYear() === date.getFullYear()
      })
      .reduce((sum, inv) => sum + (inv.amount || 0), 0)

    return {
      month,
      revenue: monthRevenue,
      expenses: monthExpenses,
    }
  })

  const COLORS = ["#3b82f6", "#10b981", "#f59e0b", "#ef4444", "#8b5cf6", "#ec4899"]

  const pendingPOs = purchaseOrders.filter((po) => po.status === "pending")
  const approvedPOs = purchaseOrders.filter((po) => po.status === "approved")
  const rejectedPOs = purchaseOrders.filter((po) => po.status === "rejected")
  const receivedPOs = purchaseOrders.filter((po) => po.status === "received" || po.status === "received_with_issues")

  const totalSalesRevenue = customerInvoices.reduce((sum, inv) => sum + (inv.amount || 0), 0)

  const pendingSalesOrders = salesOrders.filter(
    (so) => so.status === "pending" || so.status === "pending_accountant" || so.status === "pending_ceo",
  )


  const completedSalesOrders = salesOrders.filter((so) => so.status === "completed" || so.status === "shipped")

  const customerSalesMap = new Map<number, { name: string; totalSales: number; orderCount: number }>()

  salesOrders.forEach((so) => {
    const customerId = Number(so.customerId)
    const customer = customers.find((c) => Number(c.id) === customerId)

    if (customer) {
      const existing = customerSalesMap.get(customerId) || {
        name: customer.customerName || customer.name || "Unknown Customer",
        totalSales: 0,
        orderCount: 0,
      }
      // Use 'total' field instead of 'totalAmount'
      existing.totalSales += Number(so.total) || 0
      existing.orderCount += 1
      customerSalesMap.set(customerId, existing)
    }
  })

  const topCustomers = Array.from(customerSalesMap.values())
    .sort((a, b) => b.totalSales - a.totalSales)
    .slice(0, 5)

  const mostSoldProducts = salesOrders
    .flatMap((so) => so.items)
    .reduce((acc: any, item) => {
      const existing = acc.find((p: any) => p.productId === item.productId)
      if (existing) {
        existing.totalQuantity += item.quantity
        existing.totalRevenue += item.total
      } else {
        acc.push({
          productId: item.productId,
          productName: item.productName,
          totalQuantity: item.quantity,
          totalRevenue: item.total,
        })
      }
      return acc
    }, [])
    .sort((a: any, b: any) => b.totalQuantity - a.totalQuantity)
    .slice(0, 5)

  const fastMovingProducts = mostSoldProducts.filter((p: any) => p.totalQuantity > 10)
  const lowStockProducts = inventory.filter((item) => item.quantity <= item.reorderPoint)

  const showInventoryDetails = () => {
    const inventoryItems = inventory.map((item) => {
      const product = products.find((p) => String(p.id) === String(item.productId))
      const unitPrice = product?.unitPrice || 0
      return {
        name: item.productName,
        quantity: item.quantity,
        unitPrice: unitPrice,
        totalValue: item.quantity * unitPrice,
      }
    })
    setDetailDialogData({
      title: t("financial.inventory-details"),
      description: `${t("financial.total-inventory-value")}: ${formatCurrency(totalInventoryValue)}`,
      items: inventoryItems,
      type: "inventory",
    })
    setShowDetailDialog(true)
  }

  const showAPDetails = () => {
    setDetailDialogData({
      title: t("financial.ap-details"),
      description: `${t("financial.total-overdue")}: ${formatCurrency(totalAccountsPayable)}`,
      items: overdueSupplierInvoices,
      type: "ap",
    })
    setShowDetailDialog(true)
  }

  const showARDetails = () => {
    setDetailDialogData({
      title: t("financial.ar-details"),
      description: `${t("financial.total-overdue")}: ${formatCurrency(totalAccountsReceivable)}`,
      items: overdueCustomerInvoices,
      type: "ar",
    })
    setShowDetailDialog(true)
  }

  const showPendingOrdersDialog = () => {
    setDetailDialogData({
      title: t("financial.pending-orders"),
      description: `${pendingSalesOrders.length} ${t("financial.orders-awaiting-approval")}`,
      items: pendingSalesOrders.map((so) => ({
        id: so.id,
        soNumber: so.soNumber,
        status: so.status,
        total: so.total,
        orderDate: so.orderDate,
      })),
      type: "pending-orders",
    })
    setShowDetailDialog(true)
  }

  const accountantStats = [
    {
      id: "inventory",
      label: t("financial.total-inventory-value"),
      value: formatCurrency(totalInventoryValue),
      change: inventory.length > 0 ? `${inventory.length} ${t("financial.items")}` : t("financial.no-items"),
      onClick: showInventoryDetails,
    },
    {
      id: "payable",
      label: t("financial.overdue-ap"),
      value: formatCurrency(totalAccountsPayable),
      change:
        overdueSupplierInvoices.length > 0
          ? `${overdueSupplierInvoices.length} ${t("financial.overdue-invoices")}`
          : t("financial.no-overdue-invoices"),
      onClick: showAPDetails,
    },
    {
      id: "receivable",
      label: t("financial.overdue-ar"),
      value: formatCurrency(totalAccountsReceivable),
      change:
        overdueCustomerInvoices.length > 0
          ? `${overdueCustomerInvoices.length} ${t("financial.overdue-invoices")}`
          : t("financial.no-overdue-invoices"),
      onClick: showARDetails,
    },
  ]

  const poRepStats = [
    {
      id: "pending",
      label: t("financial.pending-approval"),
      value: pendingPOs.length.toString(),
      change: pendingPOs.length === 1 ? t("financial.po-awaiting-approval") : t("financial.pos-awaiting-approval"),
      color: "bg-amber-50 border-amber-200 text-amber-700",
      onClick: () => {
        const event = new CustomEvent("navigate-to-module", { detail: "purchase-orders" })
        window.dispatchEvent(event)
        setTimeout(() => {
          const filterEvent = new CustomEvent("filter-pos-by-status", { detail: "pending" })
          window.dispatchEvent(filterEvent)
        }, 100)
      },
    },
    {
      id: "received",
      label: t("financial.approved"),
      value: receivedPOs.length.toString(),
      change: receivedPOs.length === 1 ? t("financial.po-approved") : t("financial.pos-approved"),
      color: "bg-emerald-50 border-emerald-200 text-emerald-700",
      onClick: () => {
        const event = new CustomEvent("navigate-to-module", { detail: "purchase-orders" })
        window.dispatchEvent(event)
        setTimeout(() => {
          const filterEvent = new CustomEvent("filter-pos-by-status", { detail: "approved" })
          window.dispatchEvent(filterEvent)
        }, 100)
      },
    },
    {
      id: "rejected",
      label: t("financial.rejected"),
      value: rejectedPOs.length.toString(),
      change: rejectedPOs.length === 1 ? t("financial.po-rejected") : t("financial.pos-rejected"),
      color: "bg-rose-50 border-rose-200 text-rose-700",
      onClick: () => {
        const event = new CustomEvent("navigate-to-module", { detail: "purchase-orders" })
        window.dispatchEvent(event)
        setTimeout(() => {
          const filterEvent = new CustomEvent("filter-pos-by-status", { detail: "rejected" })
          window.dispatchEvent(filterEvent)
        }, 100)
      },
    },
  ]

  const salesRepStats = [
    {
      id: "pending-orders",
      label: t("financial.pending-orders"),
      value: pendingSalesOrders.length.toString(),
      change: t("financial.awaiting-approval"),
      color: "bg-amber-50 border-amber-200 text-amber-700",
      onClick: () => {
        const event = new CustomEvent("navigate-to-module", { detail: "approve-sales-orders" })
        window.dispatchEvent(event)
      },
    },
    {
      id: "completed-orders",
      label: t("financial.completed-orders"),
      value: completedSalesOrders.length.toString(),
      change: t("financial.successfully-delivered"),
      color: "bg-green-50 border-green-200 text-green-700",
      onClick: () => {
        const event = new CustomEvent("navigate-to-module", { detail: "sales-orders" })
        window.dispatchEvent(event)
      },
    },
  ]

  const warehouseStats = [
    {
      id: "low-stock",
      label: t("financial.low-stock-items"),
      value: lowStockProducts.length.toString(),
      change: lowStockProducts.length > 0 ? t("financial.needs-reordering") : t("financial.all-items-stocked"),
      color:
        lowStockProducts.length > 0
          ? "bg-red-50 border-red-200 text-red-700"
          : "bg-green-50 border-green-200 text-green-700",
      onClick: () => {
        setDetailDialogData({
          title: t("financial.low-stock-items"),
          description: `${lowStockProducts.length} ${t("financial.items-below-reorder-point")}`,
          items: lowStockProducts,
          type: "inventory",
        })
        setShowDetailDialog(true)
      },
    },
    {
      id: "fast-moving",
      label: t("financial.fast-moving-items"),
      value: fastMovingProducts.length.toString(),
      change: t("financial.high-turnover-products"),
      color: "bg-blue-50 border-blue-200 text-blue-700",
      onClick: () => {
        setDetailDialogData({
          title: t("financial.fast-moving-products"),
          description: t("financial.products-with-high-sales-volume"),
          items: fastMovingProducts,
          type: "fast-moving",
        })
        setShowDetailDialog(true)
      },
    },
    {
      id: "most-sold",
      label: t("financial.top-selling-product"),
      value: mostSoldProducts[0]?.productName || t("label.na"),
      change: mostSoldProducts[0]
        ? `${mostSoldProducts[0].totalQuantity} ${t("financial.units-sold")}`
        : t("financial.no-sales-data"),
      color: "bg-purple-50 border-purple-200 text-purple-700",
      onClick: () => {
        setDetailDialogData({
          title: t("financial.top-selling-products"),
          description: t("financial.products-ranked-by-sales-volume"),
          items: mostSoldProducts,
          type: "most-sold",
        })
        setShowDetailDialog(true)
      },
    },
  ]

  const stats =
    user.role === "po-rep"
      ? poRepStats
      : user.role === "sales-rep"
        ? salesRepStats
        : user.role === "warehouse-rep"
          ? warehouseStats
          : accountantStats

  const fetchAiInsights = async () => {
    setIsAnalyzing(true)
    try {
      const analysis = await analyzeFinancials({
        prepaidBalance,
        accountsPayable: totalAccountsPayable,
        accountsReceivable: totalAccountsReceivable,
        inventoryValue: totalInventoryValue,
        supplierInvoices: installmentSupplierInvoices,
        customerInvoices: installmentCustomerInvoices,
      })
      setAiAnalysis(analysis)
      setShowAiInsights(true)
    } catch (error) {
      console.error("Failed to fetch AI insights:", error)
    } finally {
      setIsAnalyzing(false)
    }
  }

  useEffect(() => {
    if (inventory.length > 0 || salesOrders.length > 0) {
      fetchAiInsights()
    }
  }, [])

  useEffect(() => {
    if (salesOrders.length > 0) {
      const statuses = [...new Set(salesOrders.map((so) => so.status))]
    }
  }, [salesOrders, pendingSalesOrders.length])

  const totalPayable = supplierInvoices.reduce((sum, inv) => sum + (inv.amount || 0), 0)
  const totalPaid = supplierInvoices
    .filter((inv) => inv.status === "paid")
    .reduce((sum, inv) => sum + (inv.amount || 0), 0)
  const totalUnpaid = totalPayable - totalPaid

  const totalReceivable = customerInvoices.reduce((sum, inv) => sum + (inv.amount || 0), 0)
  const totalCollected = customerInvoices.reduce((sum, inv) => sum + (inv.collectedAmount || 0), 0)
  const totalOutstanding = totalReceivable - totalCollected

  const overdueInvoices = [...overdueSupplierInvoices, ...overdueCustomerInvoices]

  const quickStats = [
    {
      id: "pending-orders",
      label: t("financial.pending-orders"),
      value: pendingSalesOrders.length.toString(),
      change: t("financial.awaiting-approval"),
      color: "bg-amber-50 border-amber-200 text-amber-700",
      onClick: showPendingOrdersDialog,
    },
    {
      id: "overdue",
      label: t("financial.overdue-invoices"),
      value: overdueInvoices.length.toString(),
      change: (
        <>
          <Money value={overdueInvoices.reduce((sum, inv) => sum + (inv.amount - (inv.collectedAmount || 0)), 0)} /> {t("common.egp-2")}
        </>
      ),
      color: "bg-red-50 border-red-200 text-red-700",
    },
  ]

  return (
    <div className="space-y-6">
      <PageHeader
        group={t("group.overview")}
        title={t("financial.title")}
        subtitle={t("financial.description")}
        actions={
          <Button onClick={fetchAiInsights} disabled={isAnalyzing}>
            {isAnalyzing ? t("loading") : t("financial.ai-analysis")}
          </Button>
        }
      />

      <KpiGrid>
        <KpiTile
          label={fill(t("financial.label-egp"), { label: t("financial.total-revenue") })}
          value={<Money value={totalRevenue} />}
          sub={t("financial.from-sales")}
          onClick={
            user.role === "sales-rep"
              ? () => {
                  const event = new CustomEvent("navigate-to-module", { detail: "sales-orders" })
                  window.dispatchEvent(event)
                }
              : undefined
          }
        />
        <KpiTile
          label={fill(t("financial.label-egp"), { label: t("financial.total-expenses") })}
          value={<Money value={totalExpenses} />}
          sub={t("financial.from-purchases")}
        />
        <KpiTile
          label={fill(t("financial.label-egp"), { label: t("financial.gross-profit") })}
          value={<Money value={grossProfit} />}
          sub={`${t("financial.margin")}: ${profitMargin === "N/A" ? t("label.na") : formatNumber(profitMargin)}%`}
        />
        <KpiTile
          label={fill(t("financial.label-egp"), { label: t("financial.inventory-value") })}
          value={<Money value={inventoryValue} />}
          sub={`${formatNumber(inventory.length)} ${t("financial.items")}`}
          onClick={user.role === "warehouse-rep" ? showInventoryDetails : undefined}
        />
      </KpiGrid>

      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>{t("financial.ar-summary")}</CardTitle>
            <CardDescription>{t("financial.ar-description")}</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              <div className="flex justify-between">
                <span>{t("financial.total-invoiced")} {t("common.egp")}</span>
                <span className="font-bold"><Money value={totalReceivable} /></span>
              </div>
              <div className="flex justify-between">
                <span>{t("financial.collected")} {t("common.egp")}</span>
                <span className="font-bold text-green-700"><Money value={totalCollected} /></span>
              </div>
              <div className="flex justify-between">
                <span>{t("financial.outstanding")} {t("common.egp")}</span>
                <span className="font-bold text-yellow-700"><Money value={totalOutstanding} /></span>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>{t("financial.ap-summary")}</CardTitle>
            <CardDescription>{t("financial.ap-description")}</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              <div className="flex justify-between">
                <span>{t("financial.total-invoiced")} {t("common.egp")}</span>
                <span className="font-bold"><Money value={totalPayable} /></span>
              </div>
              <div className="flex justify-between">
                <span>{t("financial.paid")} {t("common.egp")}</span>
                <span className="font-bold text-green-700"><Money value={totalPaid} /></span>
              </div>
              <div className="flex justify-between">
                <span>{t("financial.outstanding")} {t("common.egp")}</span>
                <span className="font-bold text-yellow-700"><Money value={totalUnpaid} /></span>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {user.role === "ceo" && showAiInsights && aiAnalysis && (
        <Card className="border-2 border-primary/20 bg-gradient-to-br from-primary/5 to-transparent">
          <CardHeader>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Sparkles className="w-5 h-5 text-primary" />
                <CardTitle>{t("financial.ai-health-analysis")}</CardTitle>
              </div>
              <StatusBadge
                status={aiAnalysis.financialHealth.status}
                label={`${statusLabel(aiAnalysis.financialHealth.status, t).toUpperCase()} - ${t("financial.score")}: ${aiAnalysis.financialHealth.score}/100`}
              />
            </div>
            <CardDescription>{aiAnalysis.financialHealth.insights}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* Key Metrics */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="p-4 rounded-lg bg-background border">
                <p className="text-sm text-muted-foreground">{t("financial.liquidity-ratio")}</p>
                <p className="text-2xl font-bold">{aiAnalysis.financialHealth.keyMetrics.liquidityRatio.toFixed(2)}</p>
              </div>
              <div className="p-4 rounded-lg bg-background border">
                <p className="text-sm text-muted-foreground">{t("financial.debt-to-asset-ratio")}</p>
                <p className="text-2xl font-bold">
                  {aiAnalysis.financialHealth.keyMetrics.debtToAssetRatio.toFixed(2)}
                </p>
              </div>
              <div className="p-4 rounded-lg bg-background border">
                <p className="text-sm text-muted-foreground">{t("financial.working-capital")} {t("common.egp")}</p>
                <p className="text-2xl font-bold">
                  <Money value={aiAnalysis.financialHealth.keyMetrics.workingCapital} />
                </p>
              </div>
            </div>

            {/* Cash Flow Predictions */}
            <div className="p-4 rounded-lg bg-background border">
              <div className="flex items-center gap-2 mb-2">
                <TrendingUp className="w-4 h-4 text-blue-600" />
                <h3 className="font-semibold">{t("financial.cash-flow-predictions")}</h3>
                <Badge variant="outline">
                  {aiAnalysis.cashFlowPrediction.confidence} {t("financial.confidence")}
                </Badge>
              </div>
              <div className="grid grid-cols-2 gap-4 mt-3">
                <div>
                  <p className="text-sm text-muted-foreground">{t("financial.next-month")} {t("common.egp")}</p>
                  <p className="text-xl font-bold"><Money value={aiAnalysis.cashFlowPrediction.nextMonth} /></p>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">{t("financial.next-quarter")} {t("common.egp")}</p>
                  <p className="text-xl font-bold"><Money value={aiAnalysis.cashFlowPrediction.nextQuarter} /></p>
                </div>
              </div>
              <p className="text-sm text-muted-foreground mt-2">{aiAnalysis.cashFlowPrediction.reasoning}</p>
            </div>

            {/* Payment Risks */}
            {aiAnalysis.paymentRisks.length > 0 && (
              <div className="p-4 rounded-lg bg-background border">
                <div className="flex items-center gap-2 mb-3">
                  <AlertTriangle className="w-4 h-4 text-yellow-700" />
                  <h3 className="font-semibold">{t("financial.payment-risk-alerts")}</h3>
                </div>
                <div className="space-y-2">
                  {aiAnalysis.paymentRisks.slice(0, 3).map((risk: any, index: number) => (
                    <div key={index} className="flex items-start justify-between p-3 rounded bg-muted/50">
                      <div className="flex-1">
                        <div className="flex items-center gap-2">
                          <p className="font-medium">{risk.customerOrSupplier}</p>
                          <Badge variant={risk.riskLevel === "high" ? "destructive" : "secondary"}>
                            {risk.riskLevel} {t("financial.risk")}
                          </Badge>
                        </div>
                        <p className="text-sm text-muted-foreground mt-1">{risk.recommendation}</p>
                      </div>
                      <div className="text-end ms-4">
                        <p className="font-semibold"><Money value={risk.amount} /> {t("common.egp-2")}</p>
                        <p className="text-xs text-muted-foreground">
                          {risk.daysOverdue} {t("financial.days-overdue")}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* AI Recommendations */}
            <div className="p-4 rounded-lg bg-background border">
              <div className="flex items-center gap-2 mb-3">
                <CheckCircle2 className="w-4 h-4 text-green-700" />
                <h3 className="font-semibold">{t("financial.ai-recommendations")}</h3>
              </div>
              <ul className="space-y-2">
                {aiAnalysis.recommendations.map((rec: string, index: number) => (
                  <li key={index} className="flex items-start gap-2 text-sm">
                    <span className="text-primary mt-0.5">•</span>
                    <span>{rec}</span>
                  </li>
                ))}
              </ul>
            </div>
          </CardContent>
        </Card>
      )}

      <KpiGrid>
        {user.role === "po-rep"
          ? poRepStats.map((stat) => (
              <KpiTile key={stat.id} label={stat.label} value={stat.value} sub={stat.change} onClick={stat.onClick} />
            ))
          : user.role === "sales-rep"
            ? salesRepStats.map((stat) => (
                <KpiTile key={stat.id} label={stat.label} value={stat.value} sub={stat.change} onClick={stat.onClick} />
              ))
            : user.role === "warehouse-rep"
              ? warehouseStats.map((stat, index) => (
                  <KpiTile key={index} label={stat.label} value={stat.value} sub={stat.change} onClick={stat.onClick} />
                ))
              : quickStats.map((stat, index) => (
                  <KpiTile key={index} label={stat.label} value={stat.value} sub={stat.change} onClick={stat.onClick} />
                ))}

        {user.role === "accountant" && (
          <KpiTile
            label={t("financial.approve-sales-orders")}
            value={pendingSalesOrders.length}
            sub={
              pendingSalesOrders.length === 1
                ? t("financial.order-pending-approval")
                : t("financial.orders-pending-approval")
            }
            onClick={() => {
              const event = new CustomEvent("navigate-to-module", { detail: "approve-sales-orders" })
              window.dispatchEvent(event)
            }}
          />
        )}
      </KpiGrid>

      {/* CEO Payment Reschedule Approvals */}
      {user.role === "ceo" && (
        <Card className="border-2 border-amber-200 bg-gradient-to-br from-amber-50 to-transparent">
          <CardHeader>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <CardTitle className="flex items-center gap-2">
                  <AlertTriangle className="w-5 h-5 text-amber-700" />
                  {t("financial.payment-reschedule-requests")}
                </CardTitle>
                <CardDescription>
                  {rescheduleRequests.length !== 1
                    ? fill(t("financial.pending-requests-awaiting"), { count: rescheduleRequests.length })
                    : fill(t("financial.pending-request-awaiting"), { count: rescheduleRequests.length })}
                </CardDescription>
              </div>
              <Badge variant="secondary" className="bg-amber-100 text-amber-700">
                {t("financial.ceo-approval-required")}
              </Badge>
            </div>
          </CardHeader>
          <CardContent>
            {rescheduleRequests.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">
                <CheckCircle2 className="w-12 h-12 mx-auto mb-3 text-green-700" />
                <p className="font-medium">{t("financial.no-pending-reschedule-requests")}</p>
                <p className="text-sm">{t("financial.all-reschedule-processed")}</p>
              </div>
            ) : (
              <div className="space-y-4">
                {rescheduleRequests.map((request) => {
                  const customer = customers.find((c) => c.id === request.customerId)
                  const displayCustomerName = request.customerName || customer?.name || "Unknown Customer"
                  return (
                    <div key={request.id} className="border rounded-lg p-4 bg-white">
                      <div className="flex justify-between items-start mb-3">
                        <div>
                          <p className="font-semibold text-lg">{displayCustomerName}</p>
                          <p className="text-sm text-muted-foreground">{t("common.so")} {request.soNumber || t("label.na")}</p>
                          <p className="text-sm text-muted-foreground">{t("common.invoice")} {request.invoiceNumber}</p>
                        </div>
                        <StatusBadge status="pending" label={t("status.pending")} />
                      </div>
                      <div className="grid grid-cols-2 md:grid-cols-3 gap-4 text-sm mb-3">
                        <div>
                          <p className="text-muted-foreground">{t("financial.current-plan")}</p>
                          <p className="font-semibold">{request.currentMonths} {t("months")}</p>
                        </div>
                        <div>
                          <p className="text-muted-foreground">{t("financial.requested-plan")}</p>
                          <p className="font-semibold text-blue-600">{request.requestedMonths} {t("months")}</p>
                        </div>
                        <div>
                          <p className="text-muted-foreground">{t("financial.requested-by")}</p>
                          <p className="font-semibold">{request.requestedBy}</p>
                        </div>
                        {request.requestedAmount && request.requestedAmount !== request.currentAmount && (
                          <>
                            <div>
                              <p className="text-muted-foreground">{t("financial.current-amount-egp")}</p>
                              <p className="font-semibold"><Money value={request.currentAmount} /></p>
                            </div>
                            <div>
                              <p className="text-muted-foreground">{t("financial.requested-amount-egp")}</p>
                              <p className="font-semibold text-blue-600"><Money value={request.requestedAmount} /></p>
                            </div>
                          </>
                        )}
                        {request.requestedDueDate && request.requestedDueDate !== request.currentDueDate && (
                          <>
                            <div>
                              <p className="text-muted-foreground">{t("financial.current-due-date")}</p>
                              <p className="font-semibold">{formatDate(request.currentDueDate, language)}</p>
                            </div>
                            <div>
                              <p className="text-muted-foreground">{t("financial.requested-due-date")}</p>
                              <p className="font-semibold text-blue-600">{formatDate(request.requestedDueDate, language)}</p>
                            </div>
                          </>
                        )}
                        <div>
                          <p className="text-muted-foreground">{t("lost-sales.request-date")}</p>
                          <p className="font-semibold">{formatDate(request.createdAt, language)}</p>
                        </div>
                      </div>
                      <div className="mb-3">
                        <p className="text-muted-foreground text-sm">{t("financial.reason")}</p>
                        <p className="text-sm">{request.reason}</p>
                      </div>
                      <div className="flex gap-2">
                        <Button
                          size="sm"
                          onClick={() => handleApproveReschedule(request.id)}
                          disabled={loadingReschedule}
                          className="bg-green-600 hover:bg-green-700"
                        >
                          <CheckCircle2 className="w-4 h-4 me-2" />
                          {t("action.approve")}
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => handleRejectReschedule(request.id)}
                          disabled={loadingReschedule}
                          className="border-red-300 text-red-700 hover:bg-red-50"
                        >
                          {t("action.reject")}
                        </Button>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      <Dialog open={showDetailDialog} onOpenChange={setShowDetailDialog}>
        <DialogContent className="sm:max-w-4xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{detailDialogData?.title}</DialogTitle>
            <DialogDescription>{detailDialogData?.description}</DialogDescription>
          </DialogHeader>
          <div className="mt-4">
            {detailDialogData?.type === "inventory" && (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t("financial.product")}</TableHead>
                    <TableHead className="text-end">{t("financial.quantity")}</TableHead>
                    <TableHead className="text-end">{t("financial.unit-price")} {t("common.egp")}</TableHead>
                    <TableHead className="text-end">{t("financial.total-value")} {t("common.egp")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {detailDialogData?.items.map((item: any, index: number) => (
                    <TableRow key={index}>
                      <TableCell className="font-medium">{item.productName || item.name}</TableCell>
                      <TableCell className="text-end">{item.quantity}</TableCell>
                      <TableCell className="text-end">
                        <Money value={item.unitPrice || item.unitCost || 0} />
                      </TableCell>
                      <TableCell className="text-end font-semibold"><Money value={item.totalValue || 0} /></TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
            {detailDialogData?.type === "fast-moving" && (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t("financial.product")}</TableHead>
                    <TableHead className="text-end">{t("financial.units-sold")}</TableHead>
                    <TableHead className="text-end">{t("financial.total-revenue")} {t("common.egp")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {detailDialogData?.items.map((item: any, index: number) => (
                    <TableRow key={index}>
                      <TableCell className="font-medium">{item.productName}</TableCell>
                      <TableCell className="text-end">{item.totalQuantity}</TableCell>
                      <TableCell className="text-end font-semibold"><Money value={item.totalRevenue} /></TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
            {detailDialogData?.type === "most-sold" && (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t("financial.rank")}</TableHead>
                    <TableHead>{t("financial.product")}</TableHead>
                    <TableHead className="text-end">{t("financial.units-sold")}</TableHead>
                    <TableHead className="text-end">{t("financial.total-revenue")} {t("common.egp")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {detailDialogData?.items.map((item: any, index: number) => (
                    <TableRow key={index}>
                      <TableCell className="font-medium">{index + 1}</TableCell>
                      <TableCell className="font-medium">{item.productName}</TableCell>
                      <TableCell className="text-end">{item.totalQuantity}</TableCell>
                      <TableCell className="text-end font-semibold"><Money value={item.totalRevenue} /></TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
            {detailDialogData?.type === "ap" && (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t("financial.invoice-number")}</TableHead>
                    <TableHead>{t("financial.supplier")}</TableHead>
                    <TableHead>{t("financial.due-date")}</TableHead>
                    <TableHead className="text-end">{t("financial.amount")} {t("common.egp")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {detailDialogData?.items.map((item: any, index: number) => (
                    <TableRow key={index}>
                      <TableCell className="font-medium">{item.invoiceNumber}</TableCell>
                      <TableCell>{item.supplierName || t("financial.unknown")}</TableCell>
                      <TableCell>{formatDate(item.dueDate, language)}</TableCell>
                      <TableCell className="text-end font-semibold text-red-700">
                        <Money value={item.amount} />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
            {detailDialogData?.type === "ar" && (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t("financial.invoice-number")}</TableHead>
                    <TableHead>{t("financial.customer")}</TableHead>
                    <TableHead>{t("financial.due-date")}</TableHead>
                    <TableHead className="text-end">{t("financial.amount")} {t("common.egp")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {detailDialogData?.items.map((item: any, index: number) => (
                    <TableRow key={index}>
                      <TableCell className="font-medium">{item.invoiceNumber}</TableCell>
                      <TableCell>{item.customerName || t("financial.unknown")}</TableCell>
                      <TableCell>{formatDate(item.dueDate, language)}</TableCell>
                      <TableCell className="text-end font-semibold text-red-700">
                        <Money value={(item.amount || 0) - (item.collectedAmount || 0)} />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
            {detailDialogData?.type === "pending-orders" && (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t("field.so-number")}</TableHead>
                    <TableHead>{t("field.status")}</TableHead>
                    <TableHead>{t("field.order-date")}</TableHead>
                    <TableHead className="text-end">{t("field.total")} {t("common.egp")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {detailDialogData?.items.map((item: any, index: number) => (
                    <TableRow key={index}>
                      <TableCell className="font-medium">{item.soNumber}</TableCell>
                      <TableCell>
                        <StatusBadge status={item.status} />
                      </TableCell>
                      <TableCell>{formatDate(item.orderDate, language)}</TableCell>
                      <TableCell className="text-end font-semibold"><Money value={item.total} /></TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
