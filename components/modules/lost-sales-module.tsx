"use client"
import { useState, useEffect } from "react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { PackageX, Plus, AlertTriangle, Loader2, Trash2 } from "lucide-react"
import { useAppContext } from "@/lib/app-context"
import { useI18n } from "@/lib/i18n-context"
import { PageHeader } from "@/components/erp/page-header"
import { KpiGrid, KpiTile } from "@/components/erp/kpi-tile"
import { ErpTable, NumHead, NumCell, ActionsHead, ActionsCell } from "@/components/erp/data-table"
import { ResponsiveList, ListCard } from "@/components/erp/responsive-list"
import { formatDate } from "@/lib/format"

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
  const { t, formatNumber, language } = useI18n()
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
        <span className="ms-2">{t("loading")}</span>
      </div>
    )
  }

  const renderRowActions = (sale: any) => (
    <Button variant="ghost" size="sm" onClick={() => handleDelete(sale.lost_sale_id)}>
      <Trash2 className="w-4 h-4 text-red-500" />
    </Button>
  )

  return (
    <div className="space-y-6">
      {/* Header */}
      <PageHeader
        group={t("group.sales")}
        title={t("lost-sales.title")}
        subtitle={t("lost-sales.description")}
        actions={
          <Button variant="outline" onClick={() => setShowAddModal(true)}>
            <Plus className="w-4 h-4 me-2" />
            {t("lost-sales.add")}
          </Button>
        }
      />

      {error && (
        <div className="flex items-center justify-center">
          <Alert variant="destructive">
            <AlertTriangle className="w-4 h-4" />
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        </div>
      )}

      {/* Summary Cards */}
      <KpiGrid>
        <KpiTile label={t("lost-sales.total-requests")} value={formatNumber(summary.totalRequests)} />
        <KpiTile label={t("lost-sales.total-quantity")} value={formatNumber(summary.totalQuantity)} />
        <KpiTile label={t("lost-sales.unique-products")} value={formatNumber(summary.uniqueProducts)} />
        <KpiTile label={t("lost-sales.unique-customers")} value={formatNumber(summary.uniqueCustomers)} />
      </KpiGrid>

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
          <ResponsiveList
            rows={filteredLostSales}
            empty={
              <div className="p-8 text-center text-muted-foreground">
                <PackageX className="w-12 h-12 mx-auto mb-2 opacity-50" />
                <p>{t("lost-sales.no-data")}</p>
              </div>
            }
            table={
              <div className="overflow-x-auto">
                <ErpTable>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{t("lost-sales.product")}</TableHead>
                      <TableHead>{t("lost-sales.customer")}</TableHead>
                      <NumHead>{t("lost-sales.quantity")}</NumHead>
                      <TableHead>{t("lost-sales.date")}</TableHead>
                      <TableHead>{t("field.email")}</TableHead>
                      <TableHead>{t("field.phone")}</TableHead>
                      <ActionsHead>{t("field.actions")}</ActionsHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredLostSales.map((sale) => (
                      <TableRow key={sale.lost_sale_id} className="hover:bg-muted/50">
                        <TableCell className="font-medium">{sale.requested_item_name}</TableCell>
                        <TableCell>{sale.customer_name || "-"}</TableCell>
                        <NumCell>{formatNumber(sale.requested_quantity)}</NumCell>
                        <TableCell>{formatDate(sale.request_date, language)}</TableCell>
                        <TableCell>{sale.customer_email || "-"}</TableCell>
                        <TableCell>{sale.customer_phone || "-"}</TableCell>
                        <ActionsCell>{renderRowActions(sale)}</ActionsCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </ErpTable>
              </div>
            }
            card={(sale: any) => (
              <ListCard
                id={sale.requested_item_name}
                amount={formatNumber(sale.requested_quantity)}
                party={sale.customer_name || "-"}
                actions={renderRowActions(sale)}
              />
            )}
          />
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
