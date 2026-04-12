"use client"
import { useState, useEffect } from "react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { PackageX, TrendingDown, Plus, AlertTriangle, Loader2, Trash2, Package, Users } from "lucide-react"
import { useAppContext } from "@/lib/app-context"
import { useI18n } from "@/lib/i18n-context"

interface LostSale {
  lost_sale_id: number
  requested_item_name: string // Product name
  customer_name: string | null
  requested_quantity: number
  customer_email: string | null
  customer_phone: string | null
  request_date: string
  created_at: string
}

interface LostSalesSummary {
  month: string
  total_requests: number
  unique_customers: number
  unique_items: number
  total_quantity_requested: number
}

interface TopLostItem {
  product_name: string
  request_count: number
  total_quantity_requested: number
  unique_customers: number
  last_requested: string
}

export function LostSalesModule() {
  const { t, formatNumber, formatCurrency, language } = useI18n()
  const { lostSales, addLostSale, deleteLostSale, loadData } = useAppContext()
  const [summary, setSummary] = useState({
    totalRequests: 0,
    totalQuantity: 0,
    uniqueProducts: 0,
    uniqueCustomers: 0,
  })
  const [detailedLostSales, setDetailedLostSales] = useState([])
  const [showAddModal, setShowAddModal] = useState(false)
  const [newLostSale, setNewLostSale] = useState({
    requestedItemName: "",
    requestedQuantity: 1,
    customerName: "",
    customerEmail: "",
    customerPhone: "",
  })
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [searchQuery, setSearchQuery] = useState("")

  const fetchData = async () => {
    setLoading(true)
    setError(null)
    try {
      const [detailRes, summaryRes] = await Promise.all([fetch("/api/lost-sales"), fetch("/api/lost-sales-summary")])

      if (!detailRes.ok) {
        throw new Error("Failed to fetch lost sales data")
      }

      const detailData = await detailRes.json()

      let summaryData = {
        totalRequests: 0,
        totalQuantity: 0,
        uniqueProducts: 0,
        uniqueCustomers: 0,
      }

      if (summaryRes.ok) {
        summaryData = await summaryRes.json()
      } else {
        summaryData = {
          totalRequests: detailData.length || 0,
          totalQuantity: detailData.reduce((sum: number, item: any) => sum + (item.requested_quantity || 0), 0),
          uniqueProducts: new Set(detailData.map((item: any) => item.requested_item_name)).size,
          uniqueCustomers: new Set(
            detailData.filter((item: any) => item.customer_name).map((item: any) => item.customer_name),
          ).size,
        }
      }

      console.log("[v0] Lost sales data fetched:", {
        detailCount: detailData.length,
        summaryData: summaryData,
      })

      setDetailedLostSales(detailData)
      setSummary(summaryData)
    } catch (err) {
      console.error("Error fetching lost sales:", err)
      setError("Failed to load lost sales data. Please try again.")
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchData()
  }, [])

  const filteredLostSales = detailedLostSales.filter((item) => {
    const matchesSearch =
      searchQuery === "" ||
      item.requested_item_name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      item.customer_name?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      item.customer_email?.toLowerCase().includes(searchQuery.toLowerCase())

    return matchesSearch
  })

  const handleAddLostSale = async () => {
    if (!newLostSale.requestedItemName.trim()) {
      setError("Product name is required")
      return
    }

    setLoading(true)
    setError(null)

    try {
      await addLostSale(newLostSale)

      console.log("[v0] Lost sale added successfully")

      // Reset form
      setNewLostSale({
        requestedItemName: "",
        requestedQuantity: 1,
        customerName: "",
        customerEmail: "",
        customerPhone: "",
      })

      // Close dialog
      setShowAddModal(false)

      // Refresh data to show new record
      await fetchData()
    } catch (err) {
      console.error("Error adding lost sale:", err)
      setError("Failed to add lost sale. Please try again.")
    } finally {
      setLoading(false)
    }
  }

  const handleDelete = async (id) => {
    setLoading(true)
    setError(null)

    try {
      await deleteLostSale(id)

      console.log("[v0] Lost sale deleted successfully")

      // Refresh data to show updated record
      await fetchData()
    } catch (err) {
      console.error("Error deleting lost sale:", err)
      setError("Failed to delete lost sale. Please try again.")
    } finally {
      setLoading(false)
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
        <span className="ml-2">{t("loading")}</span>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">{t("lost-sales.title")}</h1>
          <p className="text-muted-foreground mt-2">{t("lost-sales.description")}</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => setShowAddModal(true)}>
            <Plus className="w-4 h-4 mr-2" />
            {t("lost-sales.add")}
          </Button>
        </div>
      </div>

      {error && (
        <div className="flex items-center justify-center">
          <Alert variant="destructive">
            <AlertTriangle className="w-4 h-4" />
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        </div>
      )}

      {/* Summary Cards */}
      <div className="grid gap-4 md:grid-cols-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">{t("lost-sales.total-requests")}</CardTitle>
            <TrendingDown className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{formatNumber(summary.totalRequests)}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">{t("lost-sales.total-quantity")}</CardTitle>
            <Package className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{formatNumber(summary.totalQuantity)}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">{t("lost-sales.unique-products")}</CardTitle>
            <Package className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{formatNumber(summary.uniqueProducts)}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">{t("lost-sales.unique-customers")}</CardTitle>
            <Users className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{formatNumber(summary.uniqueCustomers)}</div>
          </CardContent>
        </Card>
      </div>

      {/* Search */}
      <div className="flex gap-2">
        <Input
          placeholder={t("action.search")}
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="max-w-sm"
        />
      </div>

      {/* Table */}
      <Card>
        <CardHeader>
          <CardTitle>{t("lost-sales.list")}</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b">
                  <th className="text-start p-2">{t("lost-sales.product")}</th>
                  <th className="text-start p-2">{t("lost-sales.customer")}</th>
                  <th className="text-start p-2">{t("lost-sales.quantity")}</th>
                  <th className="text-start p-2">{t("lost-sales.date")}</th>
                  <th className="text-start p-2">{t("field.email")}</th>
                  <th className="text-start p-2">{t("field.phone")}</th>
                  <th className="text-start p-2">{t("field.actions")}</th>
                </tr>
              </thead>
              <tbody>
                {filteredLostSales.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="text-center p-8 text-muted-foreground">
                      <PackageX className="w-12 h-12 mx-auto mb-2 opacity-50" />
                      <p>{t("lost-sales.no-data")}</p>
                    </td>
                  </tr>
                ) : (
                  filteredLostSales.map((sale) => (
                    <tr key={sale.lost_sale_id} className="border-b hover:bg-muted/50">
                      <td className="p-2 font-medium">{sale.requested_item_name}</td>
                      <td className="p-2">{sale.customer_name || "-"}</td>
                      <td className="p-2">{formatNumber(sale.requested_quantity)}</td>
                      <td className="p-2">
                        {new Date(sale.request_date).toLocaleDateString(language === "ar" ? "ar-EG" : "en-US")}
                      </td>
                      <td className="p-2">{sale.customer_email || "-"}</td>
                      <td className="p-2">{sale.customer_phone || "-"}</td>
                      <td className="p-2">
                        <Button variant="ghost" size="sm" onClick={() => handleDelete(sale.lost_sale_id)}>
                          <Trash2 className="w-4 h-4 text-red-500" />
                        </Button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {/* Add Lost Sale Modal */}
      <Dialog open={showAddModal} onOpenChange={setShowAddModal}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("lost-sales.add")}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label>{t("lost-sales.product")} *</Label>
              <Input
                value={newLostSale.requestedItemName}
                onChange={(e) => setNewLostSale({ ...newLostSale, requestedItemName: e.target.value })}
                placeholder={t("lost-sales.product-placeholder")}
              />
            </div>
            <div className="space-y-2">
              <Label>{t("lost-sales.customer")}</Label>
              <Input
                value={newLostSale.customerName}
                onChange={(e) => setNewLostSale({ ...newLostSale, customerName: e.target.value })}
                placeholder={t("lost-sales.customer-placeholder")}
              />
            </div>
            <div className="space-y-2">
              <Label>{t("lost-sales.quantity")} *</Label>
              <Input
                type="number"
                value={newLostSale.requestedQuantity}
                onChange={(e) =>
                  setNewLostSale({ ...newLostSale, requestedQuantity: Number.parseInt(e.target.value) || 1 })
                }
                placeholder={t("lost-sales.quantity-placeholder")}
              />
            </div>
            <div className="space-y-2">
              <Label>{t("field.email")}</Label>
              <Input
                type="email"
                value={newLostSale.customerEmail}
                onChange={(e) => setNewLostSale({ ...newLostSale, customerEmail: e.target.value })}
                placeholder={t("lost-sales.email-placeholder")}
              />
            </div>
            <div className="space-y-2">
              <Label>{t("field.phone")}</Label>
              <Input
                value={newLostSale.customerPhone}
                onChange={(e) => setNewLostSale({ ...newLostSale, customerPhone: e.target.value })}
                placeholder={t("lost-sales.phone-placeholder")}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowAddModal(false)}>
              {t("action.cancel")}
            </Button>
            <Button onClick={handleAddLostSale}>{t("action.save")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
