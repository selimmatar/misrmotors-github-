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
import type { User } from "@/lib/types"
import { useState, useEffect } from "react"
import { Sparkles, TrendingUp, AlertTriangle, CheckCircle2, CheckCircle } from "lucide-react"

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
        alert("Reschedule request approved!")
      }
    } catch (error) {
      alert("Failed to approve request")
    } finally {
      setLoadingReschedule(false)
    }
  }

  const handleRejectReschedule = async (requestId: string) => {
    const reason = prompt("Please provide a reason for rejection:")
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
        alert("Reschedule request rejected.")
      }
    } catch (error) {
      alert("Failed to reject request")
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
  const receivedPOs = purchaseOrders.filter((po) => po.status === "received")

  const totalSalesRevenue = customerInvoices.reduce((sum, inv) => sum + (inv.amount || 0), 0)

  const pendingSalesOrders = salesOrders.filter(
    (so) => so.status === "pending" || so.status === "pending_accountant" || so.status === "pending_ceo",
  )

  console.log("[v0] Financial Dashboard - salesOrders count:", salesOrders.length)
  console.log("[v0] Financial Dashboard - All statuses:", [...new Set(salesOrders.map((so) => so.status))])
  console.log("[v0] Financial Dashboard - pendingSalesOrders count:", pendingSalesOrders.length)

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
      id: "total-sales",
      label: t("financial.total-sales-revenue"),
      value: formatCurrency(totalSalesRevenue),
      change: `${salesOrders.length} ${t("financial.total-orders")}`,
      color: "bg-blue-50 border-blue-200 text-blue-700",
      onClick: () => {
        const event = new CustomEvent("navigate-to-module", { detail: "sales-orders" })
        window.dispatchEvent(event)
      },
    },
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
      id: "inventory-value",
      label: t("financial.total-inventory-value"),
      value: formatCurrency(totalInventoryValue),
      change: `${inventory.length} ${t("financial.products")}`,
      onClick: showInventoryDetails,
    },
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
      value: mostSoldProducts[0]?.productName || "N/A",
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
      console.error("[v0] Failed to fetch AI insights:", error)
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
      console.log("[v0] Financial Dashboard - Total SOs:", salesOrders.length, "Statuses:", statuses)
      console.log("[v0] Financial Dashboard - Pending count:", pendingSalesOrders.length)
    }
  }, [salesOrders, pendingSalesOrders.length])

  const getHealthColor = (status: string) => {
    switch (status) {
      case "excellent":
        return "text-green-600 bg-green-50"
      case "good":
        return "text-blue-600 bg-blue-50"
      case "fair":
        return "text-yellow-600 bg-yellow-50"
      case "poor":
        return "text-red-600 bg-red-50"
      default:
        return "text-gray-600 bg-gray-50"
    }
  }

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
      id: "total-revenue",
      label: t("financial.total-revenue"),
      value: formatCurrency(totalSalesRevenue),
      change: `${customerInvoices.length} ${t("financial.invoices")}`,
      color: "bg-blue-50 border-blue-200 text-blue-700",
    },
    {
      id: "inventory-value",
      label: t("financial.inventory-value"),
      value: formatCurrency(totalInventoryValue),
      change: `${inventory.length} ${t("financial.products")}`,
      color: "bg-purple-50 border-purple-200 text-purple-700",
    },
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
      change: formatCurrency(overdueInvoices.reduce((sum, inv) => sum + (inv.amount - (inv.collectedAmount || 0)), 0)),
      color: "bg-red-50 border-red-200 text-red-700",
    },
  ]

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-bold">{t("financial.title")}</h1>
          <p className="text-muted-foreground">{t("financial.description")}</p>
        </div>
        <Button onClick={fetchAiInsights} disabled={isAnalyzing}>
          {isAnalyzing ? t("message.loading") : t("financial.ai-analysis")}
        </Button>
      </div>

      <div className="grid gap-4 md:grid-cols-4">
        <Card className="bg-gradient-to-br from-green-50 to-green-100 border-green-200">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-green-800">{t("financial.total-revenue")}</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-green-900">{formatCurrency(totalRevenue)}</div>
            <p className="text-xs text-green-700">{t("financial.from-sales")}</p>
          </CardContent>
        </Card>
        <Card className="bg-gradient-to-br from-red-50 to-red-100 border-red-200">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-red-800">{t("financial.total-expenses")}</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-red-900">{formatCurrency(totalExpenses)}</div>
            <p className="text-xs text-red-700">{t("financial.from-purchases")}</p>
          </CardContent>
        </Card>
        <Card className="bg-gradient-to-br from-blue-50 to-blue-100 border-blue-200">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-blue-800">{t("financial.gross-profit")}</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-blue-900">{formatCurrency(grossProfit)}</div>
            <p className="text-xs text-blue-700">
              {t("financial.margin")}: {formatNumber(profitMargin)}%
            </p>
          </CardContent>
        </Card>
        <Card className="bg-gradient-to-br from-purple-50 to-purple-100 border-purple-200">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-purple-800">{t("financial.inventory-value")}</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-purple-900">{formatCurrency(inventoryValue)}</div>
            <p className="text-xs text-purple-700">
              {formatNumber(inventory.length)} {t("financial.items")}
            </p>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>{t("financial.ar-summary")}</CardTitle>
            <CardDescription>{t("financial.ar-description")}</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              <div className="flex justify-between">
                <span>{t("financial.total-invoiced")}</span>
                <span className="font-bold">{formatCurrency(totalReceivable)}</span>
              </div>
              <div className="flex justify-between">
                <span>{t("financial.collected")}</span>
                <span className="font-bold text-green-600">{formatCurrency(totalCollected)}</span>
              </div>
              <div className="flex justify-between">
                <span>{t("financial.outstanding")}</span>
                <span className="font-bold text-yellow-600">{formatCurrency(totalOutstanding)}</span>
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
                <span>{t("financial.total-invoiced")}</span>
                <span className="font-bold">{formatCurrency(totalPayable)}</span>
              </div>
              <div className="flex justify-between">
                <span>{t("financial.paid")}</span>
                <span className="font-bold text-green-600">{formatCurrency(totalPaid)}</span>
              </div>
              <div className="flex justify-between">
                <span>{t("financial.outstanding")}</span>
                <span className="font-bold text-yellow-600">{formatCurrency(totalUnpaid)}</span>
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
              <Badge className={getHealthColor(aiAnalysis.financialHealth.status)}>
                {aiAnalysis.financialHealth.status.toUpperCase()} - {t("financial.score")}:{" "}
                {aiAnalysis.financialHealth.score}/100
              </Badge>
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
                <p className="text-sm text-muted-foreground">{t("financial.working-capital")}</p>
                <p className="text-2xl font-bold">
                  {formatCurrency(aiAnalysis.financialHealth.keyMetrics.workingCapital)}
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
                  <p className="text-sm text-muted-foreground">{t("financial.next-month")}</p>
                  <p className="text-xl font-bold">{formatCurrency(aiAnalysis.cashFlowPrediction.nextMonth)}</p>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">{t("financial.next-quarter")}</p>
                  <p className="text-xl font-bold">{formatCurrency(aiAnalysis.cashFlowPrediction.nextQuarter)}</p>
                </div>
              </div>
              <p className="text-sm text-muted-foreground mt-2">{aiAnalysis.cashFlowPrediction.reasoning}</p>
            </div>

            {/* Payment Risks */}
            {aiAnalysis.paymentRisks.length > 0 && (
              <div className="p-4 rounded-lg bg-background border">
                <div className="flex items-center gap-2 mb-3">
                  <AlertTriangle className="w-4 h-4 text-yellow-600" />
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
                      <div className="text-right ml-4">
                        <p className="font-semibold">{formatCurrency(risk.amount)}</p>
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
                <CheckCircle2 className="w-4 h-4 text-green-600" />
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

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {user.role === "po-rep"
          ? poRepStats.map((stat) => (
              <Card
                key={stat.id}
                className={`cursor-pointer transition-all hover:shadow-lg border-2 ${stat.color}`}
                onClick={stat.onClick}
              >
                <CardContent className="pt-6">
                  <div className="space-y-2">
                    <p className="text-sm font-medium">{stat.label}</p>
                    <p className="text-3xl font-bold">{stat.value}</p>
                    <p className="text-xs font-medium">{stat.change}</p>
                  </div>
                </CardContent>
              </Card>
            ))
          : user.role === "sales-rep"
            ? salesRepStats.map((stat) => (
                <Card
                  key={stat.id}
                  className={`cursor-pointer transition-all hover:shadow-lg border-2 ${stat.color}`}
                  onClick={stat.onClick}
                >
                  <CardContent className="pt-6">
                    <div className="space-y-2">
                      <p className="text-sm font-medium">{stat.label}</p>
                      <p className="text-3xl font-bold">{stat.value}</p>
                      <p className="text-xs font-medium">{stat.change}</p>
                    </div>
                  </CardContent>
                </Card>
              ))
            : user.role === "warehouse-rep"
              ? warehouseStats.map((stat, index) => (
                  <Card
                    key={index}
                    className={`cursor-pointer transition-all hover:shadow-lg hover:ring-2 hover:ring-primary border-2 ${stat.color}`}
                    onClick={stat.onClick}
                  >
                    <CardContent className="pt-6">
                      <div className="space-y-2">
                        <p className="text-sm text-muted-foreground">{stat.label}</p>
                        <p className="text-2xl font-bold">{stat.value}</p>
                        <p className="text-xs text-blue-600">{stat.change}</p>
                      </div>
                    </CardContent>
                  </Card>
                ))
              : quickStats.map((stat, index) => (
                  <Card
                    key={index}
                    className="cursor-pointer transition-all hover:shadow-lg hover:ring-2 hover:ring-primary"
                    onClick={stat.onClick}
                  >
                    <CardContent className="pt-6">
                      <div className="space-y-2">
                        <p className="text-sm text-muted-foreground">{stat.label}</p>
                        <p className="text-3xl font-bold">{stat.value}</p>
                        <p className="text-xs text-blue-600">{stat.change}</p>
                      </div>
                    </CardContent>
                  </Card>
                ))}

        {user.role === "accountant" && (
          <Card
            className="cursor-pointer transition-all hover:shadow-lg hover:ring-2 hover:ring-orange-500 border-2 border-orange-200 bg-gradient-to-br from-orange-50 to-transparent"
            onClick={() => {
              const event = new CustomEvent("navigate-to-module", { detail: "approve-sales-orders" })
              window.dispatchEvent(event)
            }}
          >
            <CardContent className="pt-6">
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <CheckCircle className="w-5 h-5 text-orange-600" />
                  <p className="text-sm text-muted-foreground font-medium">{t("financial.approve-sales-orders")}</p>
                </div>
                <p className="text-3xl font-bold text-orange-600">{pendingSalesOrders.length}</p>
                <p className="text-xs text-orange-600 font-medium">
                  {pendingSalesOrders.length === 1
                    ? t("financial.order-pending-approval")
                    : t("financial.orders-pending-approval")}
                </p>
              </div>
            </CardContent>
          </Card>
        )}
      </div>

      {/* CEO Payment Reschedule Approvals */}
      {user.role === "ceo" && (
        <Card className="border-2 border-amber-200 bg-gradient-to-br from-amber-50 to-transparent">
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="flex items-center gap-2">
                  <AlertTriangle className="w-5 h-5 text-amber-600" />
                  Payment Reschedule Requests
                </CardTitle>
                <CardDescription>
                  {rescheduleRequests.length} pending request{rescheduleRequests.length !== 1 ? "s" : ""} awaiting your approval
                </CardDescription>
              </div>
              <Badge variant="secondary" className="bg-amber-100 text-amber-700">
                CEO Approval Required
              </Badge>
            </div>
          </CardHeader>
          <CardContent>
            {rescheduleRequests.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">
                <CheckCircle2 className="w-12 h-12 mx-auto mb-3 text-green-500" />
                <p className="font-medium">No pending reschedule requests</p>
                <p className="text-sm">All payment reschedule requests have been processed</p>
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
                          <p className="text-sm text-muted-foreground">SO: {request.soNumber || "N/A"}</p>
                          <p className="text-sm text-muted-foreground">Invoice: {request.invoiceNumber}</p>
                        </div>
                        <Badge variant="outline" className="border-amber-500 text-amber-700">
                          Pending
                        </Badge>
                      </div>
                      <div className="grid grid-cols-2 md:grid-cols-3 gap-4 text-sm mb-3">
                        <div>
                          <p className="text-muted-foreground">Current Plan</p>
                          <p className="font-semibold">{request.currentMonths} months</p>
                        </div>
                        <div>
                          <p className="text-muted-foreground">Requested Plan</p>
                          <p className="font-semibold text-blue-600">{request.requestedMonths} months</p>
                        </div>
                        <div>
                          <p className="text-muted-foreground">Requested By</p>
                          <p className="font-semibold">{request.requestedBy}</p>
                        </div>
                        {request.requestedAmount && request.requestedAmount !== request.currentAmount && (
                          <>
                            <div>
                              <p className="text-muted-foreground">Current Amount</p>
                              <p className="font-semibold">{formatCurrency(request.currentAmount)}</p>
                            </div>
                            <div>
                              <p className="text-muted-foreground">Requested Amount</p>
                              <p className="font-semibold text-blue-600">{formatCurrency(request.requestedAmount)}</p>
                            </div>
                          </>
                        )}
                        {request.requestedDueDate && request.requestedDueDate !== request.currentDueDate && (
                          <>
                            <div>
                              <p className="text-muted-foreground">Current Due Date</p>
                              <p className="font-semibold">{request.currentDueDate}</p>
                            </div>
                            <div>
                              <p className="text-muted-foreground">Requested Due Date</p>
                              <p className="font-semibold text-blue-600">{request.requestedDueDate}</p>
                            </div>
                          </>
                        )}
                        <div>
                          <p className="text-muted-foreground">Request Date</p>
                          <p className="font-semibold">{new Date(request.createdAt).toLocaleDateString()}</p>
                        </div>
                      </div>
                      <div className="mb-3">
                        <p className="text-muted-foreground text-sm">Reason:</p>
                        <p className="text-sm">{request.reason}</p>
                      </div>
                      <div className="flex gap-2">
                        <Button
                          size="sm"
                          onClick={() => handleApproveReschedule(request.id)}
                          disabled={loadingReschedule}
                          className="bg-green-600 hover:bg-green-700"
                        >
                          <CheckCircle2 className="w-4 h-4 mr-2" />
                          Approve
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => handleRejectReschedule(request.id)}
                          disabled={loadingReschedule}
                          className="border-red-300 text-red-600 hover:bg-red-50"
                        >
                          Reject
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
        <DialogContent className="max-w-4xl max-h-[80vh] overflow-y-auto">
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
                    <TableHead className="text-right">{t("financial.quantity")}</TableHead>
                    <TableHead className="text-right">{t("financial.unit-price")}</TableHead>
                    <TableHead className="text-right">{t("financial.total-value")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {detailDialogData?.items.map((item: any, index: number) => (
                    <TableRow key={index}>
                      <TableCell className="font-medium">{item.productName || item.name}</TableCell>
                      <TableCell className="text-right">{item.quantity}</TableCell>
                      <TableCell className="text-right">
                        {formatCurrency(item.unitPrice || item.unitCost || 0)}
                      </TableCell>
                      <TableCell className="text-right font-semibold">{formatCurrency(item.totalValue || 0)}</TableCell>
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
                    <TableHead className="text-right">{t("financial.units-sold")}</TableHead>
                    <TableHead className="text-right">{t("financial.total-revenue")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {detailDialogData?.items.map((item: any, index: number) => (
                    <TableRow key={index}>
                      <TableCell className="font-medium">{item.productName}</TableCell>
                      <TableCell className="text-right">{item.totalQuantity}</TableCell>
                      <TableCell className="text-right font-semibold">{formatCurrency(item.totalRevenue)}</TableCell>
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
                    <TableHead className="text-right">{t("financial.units-sold")}</TableHead>
                    <TableHead className="text-right">{t("financial.total-revenue")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {detailDialogData?.items.map((item: any, index: number) => (
                    <TableRow key={index}>
                      <TableCell className="font-medium">{index + 1}</TableCell>
                      <TableCell className="font-medium">{item.productName}</TableCell>
                      <TableCell className="text-right">{item.totalQuantity}</TableCell>
                      <TableCell className="text-right font-semibold">{formatCurrency(item.totalRevenue)}</TableCell>
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
                    <TableHead className="text-right">{t("financial.amount")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {detailDialogData?.items.map((item: any, index: number) => (
                    <TableRow key={index}>
                      <TableCell className="font-medium">{item.invoiceNumber}</TableCell>
                      <TableCell>{item.supplierName || t("financial.unknown")}</TableCell>
                      <TableCell>{item.dueDate}</TableCell>
                      <TableCell className="text-right font-semibold text-red-600">
                        {formatCurrency(item.amount)}
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
                    <TableHead className="text-right">{t("financial.amount")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {detailDialogData?.items.map((item: any, index: number) => (
                    <TableRow key={index}>
                      <TableCell className="font-medium">{item.invoiceNumber}</TableCell>
                      <TableCell>{item.customerName || t("financial.unknown")}</TableCell>
                      <TableCell>{item.dueDate}</TableCell>
                      <TableCell className="text-right font-semibold text-red-600">
                        {formatCurrency((item.amount || 0) - (item.collectedAmount || 0))}
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
                    <TableHead className="text-right">{t("field.total")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {detailDialogData?.items.map((item: any, index: number) => (
                    <TableRow key={index}>
                      <TableCell className="font-medium">{item.soNumber}</TableCell>
                      <TableCell>
                        <Badge variant="outline">{item.status}</Badge>
                      </TableCell>
                      <TableCell>{item.orderDate}</TableCell>
                      <TableCell className="text-right font-semibold">{formatCurrency(item.total)}</TableCell>
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
