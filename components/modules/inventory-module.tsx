"use client"

import { Textarea } from "@/components/ui/textarea"
import type React from "react"

import { useState, useEffect, useMemo } from "react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Badge } from "@/components/ui/badge"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { useAppContext } from "@/lib/app-context"
import { analyzeInventory } from "@/lib/ai-utils"
import { ReportGenerator } from "@/components/report-generator"
import type { UserRole, DeliveryPermit, SalesOrder } from "@/lib/types"
import {
  AlertCircle,
  Sparkles,
  Loader2,
  Filter,
  Camera,
  ImageIcon,
  X,
  ChevronLeft,
  ChevronRight,
  Package,
  Clock,
  CheckCircle,
  Eye,
  Warehouse,
  Search,
  RotateCcw,
} from "lucide-react"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { useI18n } from "@/lib/i18n-context"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"

interface InventoryModuleProps {
  userRole: UserRole
}

interface PendingItem {
  id: string
  productId: string
  productName: string
  sku: string
  quantity: number
  unitPrice: number
  total: number
  soId?: string
  soNumber?: string
  customerId: string
  customerName: string
  orderDate: string
  dpStatus: string
  dpId: string
  dpNumber?: string
}

interface SoldItem extends PendingItem {
  soldDate: string
}

interface WarehouseType {
  id: number
  name: string
  location: string
  isDefault: boolean
}

export function InventoryModule({ userRole }: InventoryModuleProps) {
  const { t, formatNumber, formatCurrency, formatDate, language } = useI18n()
  const { inventory, salesOrders, customers, products, suppliers, warehouses: appWarehouses } = useAppContext()

  const [aiAnalysis, setAiAnalysis] = useState<any>(null)
  const [isAnalyzing, setIsAnalyzing] = useState(false)
  const [showAiInsights, setShowAiInsights] = useState(false)
  const [categoryFilter, setCategoryFilter] = useState<string>("all")
  const [warehouseFilter, setWarehouseFilter] = useState<string>("all")
  const [showPhotoDialog, setShowPhotoDialog] = useState(false)
  const [selectedProductForPhoto, setSelectedProductForPhoto] = useState<any>(null)
  const [productImages, setProductImages] = useState<any[]>([])
  const [isUploadingPhoto, setIsUploadingPhoto] = useState(false)
  const [selectedImageIndex, setSelectedImageIndex] = useState(0)

  const [deliveryPermits, setDeliveryPermits] = useState<DeliveryPermit[]>([])
  const [soldDateFrom, setSoldDateFrom] = useState<string>("")
  const [soldDateTo, setSoldDateTo] = useState<string>("")
  const [selectedSODetails, setSelectedSODetails] = useState<SalesOrder | null>(null)
  const [showSODetailsDialog, setShowSODetailsDialog] = useState(false)

  const [warehouses, setAppWarehouses] = useState<WarehouseType[]>([])
  const [warehouseFilterState, setWarehouseFilterState] = useState<string>("all")
  const [showAddWarehouseDialog, setShowAddWarehouseDialog] = useState(false)
  const [newWarehouseName, setNewWarehouseName] = useState("")
  const [newWarehouseLocation, setNewWarehouseLocation] = useState("")
  const [newWarehouseAddress, setNewWarehouseAddress] = useState("")
  const [isCreatingWarehouse, setIsCreatingWarehouse] = useState(false)
  const [removeReturnedItemDialog, setRemoveReturnedItemDialog] = useState(false)
  const [selectedReturnedItem, setSelectedReturnedItem] = useState<any>(null)
  const [isRemovingItem, setIsRemovingItem] = useState(false)

  const [uniqueCategories, setUniqueCategories] = useState<Array<{ category_id: number; category_name: string }>>([])
  const [searchQuery, setSearchQuery] = useState("")
  const [showAddCategoryDialog, setShowAddCategoryDialog] = useState(false)
  const [newCategoryName, setNewCategoryName] = useState("")
  const [isCreatingCategory, setIsCreatingCategory] = useState(false)

  // Fetch categories
  useEffect(() => {
    const fetchCategories = async () => {
      try {
        const response = await fetch("/api/categories")
        if (response.ok) {
          const data = await response.json()
          setUniqueCategories(data)
        }
      } catch (error) {
        console.error("Error fetching categories:", error)
      }
    }
    fetchCategories()
  }, [])

  useEffect(() => {
    const fetchDeliveryPermits = async () => {
      try {
        const response = await fetch("/api/delivery-permits")
        if (response.ok) {
          const data = await response.json()
          setDeliveryPermits(data)
          console.log("[v0] Inventory: Refreshed delivery permits, count:", data.length)
        }
      } catch (error) {
        console.error("Error fetching delivery permits:", error)
      }
    }

    // Initial fetch
    fetchDeliveryPermits()

    // Auto-refresh every 10 seconds to detect signed DP uploads
    const interval = setInterval(fetchDeliveryPermits, 10000)

    return () => clearInterval(interval)
  }, [])

  useEffect(() => {
    const fetchWarehouses = async () => {
      try {
        const response = await fetch("/api/warehouses")
        if (response.ok) {
          const data = await response.json()
          setAppWarehouses(data)
        }
      } catch (error) {
        console.error("Error fetching warehouses:", error)
      }
    }
    fetchWarehouses()
  }, [])

  const pendingItems: PendingItem[] = useMemo(() => {
    const items: PendingItem[] = []

    deliveryPermits.forEach((dp) => {
      const dpStatus = dp.status || "NO_DP"

      console.log(`[v0] Inventory Pending - DP ${dp.permitNo || dp.permit_no}: status = ${dpStatus}, DP ID = ${dp.id}`)

      // Only show pending if DP status is NOT SUBMITTED_SIGNED or APPROVED
      if (dpStatus !== "SUBMITTED_SIGNED" && dpStatus !== "APPROVED") {
        const so = salesOrders.find(
          (s) =>
            s.id === dp.soId ||
            String(s.id) === String(dp.soId) ||
            s.id === dp.salesOrderId ||
            String(s.id) === String(dp.salesOrderId),
        )
        const customer = customers.find(
          (c) => c.id === dp.customerId || String(c.id) === String(dp.customerId) || c.id === so?.customerId,
        )

        dp.items?.forEach((item) => {
          const product = products.find((p) => String(p.id) === String(item.productId) || p.id === item.productId)

          items.push({
            id: `${dp.id}-${item.productId}`, // Unique ID per DP and product
            productId: item.productId,
            productName: item.itemNameSnapshot || item.productName || product?.productName || "Unknown Product",
            sku: item.skuSnapshot || item.sku || product?.sku || "-",
            quantity: item.quantity,
            unitPrice: item.unitPrice,
            total: item.total,
            soId: so?.id,
            soNumber: so?.soNumber || dp.soNumber,
            customerId: dp.customerId || so?.customerId,
            customerName: customer?.name || dp.customerName || "Unknown Customer",
            orderDate: dp.createdAt || so?.orderDate,
            dpStatus: dpStatus,
            dpId: dp.id,
            dpNumber: dp.permitNo || dp.permit_no, // Add DP number for display
          })
        })
      }
    })

    return items
  }, [deliveryPermits, salesOrders, customers, products])

  const soldItems: SoldItem[] = useMemo(() => {
    const items: SoldItem[] = []

    deliveryPermits.forEach((dp) => {
      const dpStatus = dp.status || "NO_DP"

      // Only show sold if DP status is SUBMITTED_SIGNED or APPROVED
      if (dpStatus === "SUBMITTED_SIGNED" || dpStatus === "APPROVED") {
        console.log(
          `[v0] Inventory Sold - DP ${dp.permitNo || dp.permit_no}: status = ${dpStatus}, DP ID = ${dp.id}, Sold Date = ${dp.submittedSignedAt || dp.approvedAt || dp.createdAt}`,
        )

        const so = salesOrders.find(
          (s) =>
            s.id === dp.soId ||
            String(s.id) === String(dp.soId) ||
            s.id === dp.salesOrderId ||
            String(s.id) === String(dp.salesOrderId),
        )
        const customer = customers.find(
          (c) => c.id === dp.customerId || String(c.id) === String(dp.customerId) || c.id === so?.customerId,
        )
        const soldDate = dp.submittedSignedAt || dp.approvedAt || dp.createdAt

        if (soldDateFrom && new Date(soldDate) < new Date(soldDateFrom)) return
        if (soldDateTo && new Date(soldDate) > new Date(soldDateTo)) return

        dp.items?.forEach((item) => {
          const product = products.find((p) => String(p.id) === String(item.productId) || p.id === item.productId)

          items.push({
            id: `${dp.id}-${item.productId}`, // Unique ID per DP and product
            productId: item.productId,
            productName: item.itemNameSnapshot || item.productName || product?.productName || "Unknown Product",
            sku: item.skuSnapshot || item.sku || product?.sku || "-",
            quantity: item.quantity,
            unitPrice: item.unitPrice,
            total: item.total,
            soId: so?.id,
            soNumber: so?.soNumber || dp.soNumber,
            customerId: dp.customerId || so?.customerId,
            customerName: customer?.name || dp.customerName || "Unknown Customer",
            orderDate: dp.createdAt || so?.orderDate,
            dpStatus: dpStatus,
            dpId: dp.id,
            dpNumber: dp.permitNo || dp.permit_no, // Add DP number for display
            soldDate: soldDate,
          })
        })
      }
    })

    return items.sort((a, b) => new Date(b.soldDate).getTime() - new Date(a.soldDate).getTime())
  }, [deliveryPermits, salesOrders, customers, products, soldDateFrom, soldDateTo])

  const handleViewSODetails = (item: PendingItem | SoldItem) => {
    const so = salesOrders.find((s) => s.id === item.soId || String(s.id) === String(item.soId))
    if (so) {
      setSelectedSODetails(so)
      setShowSODetailsDialog(true)
    }
  }

  const filteredInventory = useMemo(() => {
    let filtered = inventory

    // Search filter
    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase().trim()
      filtered = filtered.filter((item) => {
        const productName = (item.productName || "").toLowerCase()
        const sku = (item.sku || "").toLowerCase()
        const outsourcedName = (item.outsourcedName || "").toLowerCase()
        return productName.includes(query) || sku.includes(query) || outsourcedName.includes(query)
      })
    }

    if (categoryFilter !== "all") {
      filtered = filtered.filter((item) => {
        const product = products.find((p) => String(p.id) === String(item.productId))
        return product?.categoryId === categoryFilter
      })
    }

    if (warehouseFilter !== "all") {
      filtered = filtered.filter((item) => String(item.warehouseId) === warehouseFilter)
    } else {
      // When "All Warehouses" is selected, aggregate regular products by productId.
      // Outsourced and returned items each have their own inventory row (no product_id),
      // so they must never be collapsed — use inventory_id as their unique key.
      const aggregatedMap = new Map<string, any>()

      filtered.forEach((item) => {
        // Outsourced or returned items: key by inventory_id so every row is kept separate
        const isUniqueRow = item.isOutsourced || item.isReturned || !item.productId
        const productKey = isUniqueRow
          ? `inv-${item.inventoryId || item.id}`
          : String(item.productId)

        if (!isUniqueRow && aggregatedMap.has(productKey)) {
          const existing = aggregatedMap.get(productKey)
          existing.quantity += item.quantity || 0
          existing.reorderPoint = Math.max(existing.reorderPoint || 0, item.reorderPoint || 0)
        } else {
          aggregatedMap.set(productKey, {
            ...item,
            id: isUniqueRow ? item.id : `aggregated-${productKey}`,
            quantity: item.quantity || 0,
            warehouseName: isUniqueRow ? (item.warehouseName || "Main Warehouse") : "All Warehouses",
            location: isUniqueRow ? (item.location || "Warehouse") : "All Warehouses",
          })
        }
      })

      filtered = Array.from(aggregatedMap.values())
    }

    // Exclude returned items from On Hand — they go into the Returns tab
    filtered = filtered.filter((item) => !item.isReturned)

    return filtered
  }, [inventory, categoryFilter, warehouseFilter, products, searchQuery])

  const returnedItems = useMemo(() => {
    if (!inventory) return []
    return inventory.filter((item: any) => item.isReturned === true)
  }, [inventory])

  const lowStockItems = filteredInventory.filter((item) => item.quantity <= item.reorderPoint && item.quantity > 0)

  const totalValue = filteredInventory.reduce((sum, item) => sum + item.quantity * (item.unitCost || 0), 0)

  const handleAnalyzeInventory = async () => {
    setIsAnalyzing(true)
    try {
      const analysis = await analyzeInventory(inventory, products, suppliers, language as "en" | "ar")
      setAiAnalysis(analysis)
      setShowAiInsights(true)
    } catch (error) {
      console.error("Error analyzing inventory:", error)
    } finally {
      setIsAnalyzing(false)
    }
  }

  const handleRemoveReturnedItem = (item: any) => {
    setSelectedReturnedItem(item)
    setRemoveReturnedItemDialog(true)
  }

  const handleConfirmRemoveReturnedItem = async () => {
    if (!selectedReturnedItem) return

    setIsRemovingItem(true)
    try {
      const payload = {
        inventoryId: selectedReturnedItem.inventoryId || selectedReturnedItem.id,
        quantity: selectedReturnedItem.quantity,
        unitCost: selectedReturnedItem.unitCost,
        supplierName: selectedReturnedItem.supplierName,
        supplierNameId: selectedReturnedItem.supplierId,
        soNumber: selectedReturnedItem.soNumber,
        productName: selectedReturnedItem.productName,
      }
      
      const response = await fetch("/api/inventory/remove-returned", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      })
      
      if (response.ok) {
        alert("Returned item removed successfully. Supplier credit has been created.")
        setRemoveReturnedItemDialog(false)
        setSelectedReturnedItem(null)
        // Refresh inventory
        location.reload()
      } else {
        const error = await response.json()
        alert("Error: " + (error.message || "Failed to remove returned item"))
      }
    } catch (error) {
      alert("Error removing returned item: " + String(error))
    } finally {
      setIsRemovingItem(false)
    }
  }

  const handleViewPhotos = async (item: any) => {
    setSelectedProductForPhoto(item)
    setSelectedImageIndex(0)
    setShowPhotoDialog(true)

    try {
      const response = await fetch(`/api/product-images?productId=${item.productId}`)
      if (response.ok) {
        const images = await response.json()
        setProductImages(images)
      }
    } catch (error) {
      console.error("Error fetching product images:", error)
    }
  }

  const handlePhotoUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file || !selectedProductForPhoto) return

    setIsUploadingPhoto(true)
    try {
      const formData = new FormData()
      formData.append("file", file)
      formData.append("productId", selectedProductForPhoto.productId)

      const response = await fetch("/api/product-images", {
        method: "POST",
        body: formData,
      })

      if (response.ok) {
        const imagesResponse = await fetch(`/api/product-images?productId=${selectedProductForPhoto.productId}`)
        if (imagesResponse.ok) {
          const images = await imagesResponse.json()
          setProductImages(images)
          setSelectedImageIndex(0) // Show the newly uploaded image (most recent)
          console.log("[v0] Image uploaded successfully, fetched images:", images)
        }
      }
    } catch (error) {
      console.error("Error uploading photo:", error)
    } finally {
      setIsUploadingPhoto(false)
    }
  }

  // Create category lookup map
  const categoryLookup = useMemo(() => {
    const map = new Map<number, string>()
    uniqueCategories.forEach((cat) => {
      map.set(cat.category_id, cat.category_name)
    })
    return map
  }, [uniqueCategories])

  // Get category name by ID
  const getCategoryName = (categoryId: any) => {
    if (!categoryId) return "Uncategorized"
    const numId = typeof categoryId === 'string' ? parseInt(categoryId) : categoryId
    return categoryLookup.get(numId) || `Category ${categoryId}`
  }

  const handleCreateCategory = async () => {
    if (!newCategoryName.trim()) return
    
    setIsCreatingCategory(true)
    try {
      const response = await fetch("/api/categories", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ categoryName: newCategoryName.trim() }),
      })
      
      if (response.ok) {
        const newCategory = await response.json()
        setUniqueCategories([...uniqueCategories, newCategory])
        setNewCategoryName("")
        setShowAddCategoryDialog(false)
      } else {
        const error = await response.json()
        alert(error.error || "Failed to create category")
      }
    } catch (error) {
      console.error("Error creating category:", error)
      alert("Failed to create category")
    } finally {
      setIsCreatingCategory(false)
    }
  }

  const handleCreateWarehouse = async () => {
    if (!newWarehouseName.trim()) return
    
    setIsCreatingWarehouse(true)
    try {
      const response = await fetch("/api/warehouses", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ 
          name: newWarehouseName.trim(),
          location: newWarehouseLocation.trim() || null,
          address: newWarehouseAddress.trim() || null
        }),
      })
      
      if (response.ok) {
        const newWarehouse = await response.json()
        setAppWarehouses([...warehouses, newWarehouse])
        setNewWarehouseName("")
        setNewWarehouseLocation("")
        setNewWarehouseAddress("")
        setShowAddWarehouseDialog(false)
        alert("Warehouse created successfully!")
      } else {
        const error = await response.json()
        alert(error.error || "Failed to create warehouse")
      }
    } catch (error) {
      console.error("Error creating warehouse:", error)
      alert("Failed to create warehouse")
    } finally {
      setIsCreatingWarehouse(false)
    }
  }

  const canViewReports = userRole === "ceo" || userRole === "accountant" || userRole === "warehouse-rep"

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">{t("inventory.title")}</h1>
          <p className="text-muted-foreground mt-2">{t("inventory.description")}</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => setShowAddCategoryDialog(true)}>
            + Category
          </Button>
          <Button variant="outline" onClick={handleAnalyzeInventory} disabled={isAnalyzing}>
            {isAnalyzing ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Sparkles className="w-4 h-4 mr-2" />}
            {t("inventory.ai-insights")}
          </Button>
          {canViewReports && <ReportGenerator reportType="inventory" />}
        </div>
      </div>

      {lowStockItems.length > 0 && (
        <Card className="border-yellow-200 bg-yellow-50">
          <CardContent className="pt-6">
            <div className="flex items-start gap-3">
              <AlertCircle className="w-5 h-5 text-yellow-600 mt-0.5" />
              <div>
                <h3 className="font-semibold text-yellow-900">{t("inventory.low-stock-alert")}</h3>
                <p className="text-sm text-yellow-700 mt-1">
                  {formatNumber(lowStockItems.length)} {t("inventory.items-below-reorder")}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      <div className="flex flex-wrap gap-4 items-center">
        <div className="relative flex-1 min-w-[200px] max-w-[400px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            placeholder={t("inventory.search-placeholder") || "Search by name, SKU..."}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-9"
          />
        </div>
        <div className="flex items-center gap-2">
          <Filter className="w-4 h-4 text-muted-foreground" />
          <Select value={categoryFilter} onValueChange={setCategoryFilter}>
            <SelectTrigger className="w-[180px]">
              <SelectValue placeholder={t("inventory.filter-category")} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t("inventory.all-categories")}</SelectItem>
              {uniqueCategories.map((cat) => (
                <SelectItem key={cat.category_id} value={String(cat.category_id)}>
                  {cat.category_name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="flex items-center gap-2">
          <Package className="w-4 h-4 text-muted-foreground" />
          <Select value={warehouseFilter} onValueChange={setWarehouseFilter}>
            <SelectTrigger className="w-[180px]">
              <SelectValue placeholder="Filter by Warehouse" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Warehouses</SelectItem>
              {(appWarehouses || []).map((wh: any) => (
                <SelectItem key={wh.id} value={String(wh.id)}>
                  {wh.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => setShowAddWarehouseDialog(true)}
          className="flex items-center gap-2"
        >
          <Warehouse className="w-4 h-4" />
          Add Warehouse
        </Button>
      </div>

      <Tabs defaultValue="on-hand" className="space-y-4">
        <TabsList className="grid w-full grid-cols-4">
          <TabsTrigger value="on-hand" className="gap-2">
            <Package className="w-4 h-4" />
            {t("inventory.on-hand")} ({formatNumber(filteredInventory.length)})
          </TabsTrigger>
          <TabsTrigger value="pending" className="gap-2">
            <Clock className="w-4 h-4" />
            {t("inventory.pending")} ({formatNumber(pendingItems.length)})
          </TabsTrigger>
          <TabsTrigger value="sold" className="gap-2">
            <CheckCircle className="w-4 h-4" />
            {t("inventory.sold")} ({formatNumber(soldItems.length)})
          </TabsTrigger>
          <TabsTrigger value="returns" className="gap-2">
            <RotateCcw className="w-4 h-4" />
            Returns ({formatNumber(returnedItems.length)})
          </TabsTrigger>
        </TabsList>

        {/* On Hand Inventory Tab */}
        <TabsContent value="on-hand" className="space-y-4">
          <div className="grid gap-4 md:grid-cols-4">
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium">{t("inventory.total-items")}</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{formatNumber(filteredInventory.length)}</div>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium">{t("inventory.total-value")}</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{formatCurrency(totalValue)}</div>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium">{t("inventory.low-stock")}</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold text-yellow-600">{formatNumber(lowStockItems.length)}</div>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium">{t("inventory.out-of-stock")}</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold text-red-600">
                  {formatNumber(filteredInventory.filter((i) => i.quantity === 0).length)}
                </div>
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader>
              <CardTitle>{t("inventory.stock-levels")}</CardTitle>
              <CardDescription>{t("inventory.stock-description")}</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{t("field.product-name")}</TableHead>
                      <TableHead>{t("field.sku")}</TableHead>
                      <TableHead>{t("field.quantity")}</TableHead>
                      <TableHead>{t("inventory.reorder-point")}</TableHead>
                      <TableHead>{t("field.unit-cost")}</TableHead>
                      <TableHead>{t("field.total-value")}</TableHead>
                      <TableHead>{t("field.supplier")}</TableHead>
                      <TableHead>{t("field.so-number")}</TableHead>
                      {warehouseFilter !== "all" && <TableHead>{t("warehouse.warehouse")}</TableHead>}
                      <TableHead>{t("field.status")}</TableHead>
                      <TableHead>Returned Items</TableHead>
                      <TableHead>{t("photo.photos")}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredInventory.map((item) => (
                      <TableRow key={item.id}>
                        <TableCell className="font-medium">
                          <div className="flex items-center gap-2">
                            <span>{item.productName || "Unknown"}</span>
                            {item.isOutsourced && (
                              <Badge variant="secondary" className="text-xs bg-purple-100 text-purple-700 border-purple-200">
                                Outsourced
                              </Badge>
                            )}
                          </div>
                        </TableCell>
                        <TableCell>{item.sku}</TableCell>
                        <TableCell>{formatNumber(item.quantity)}</TableCell>
                        <TableCell>{formatNumber(item.reorderPoint)}</TableCell>
                        <TableCell>{formatCurrency(item.unitCost ?? 0)}</TableCell>
                        <TableCell>{formatCurrency(item.quantity * (item.unitCost ?? 0))}</TableCell>
                        <TableCell className="text-sm text-muted-foreground">
                          {item.supplierName || "—"}
                        </TableCell>
                        <TableCell className="text-sm text-muted-foreground">
                          {item.soNumber || "—"}
                        </TableCell>
                        {warehouseFilter !== "all" && (
                          <TableCell>
                            <Badge variant="outline" className="gap-1">
                              <Warehouse className="w-3 h-3" />
                              {item.warehouseName || item.location || "Main"}
                            </Badge>
                          </TableCell>
                        )}
                        <TableCell>
                          <div className="flex flex-col gap-1">
                            {item.isReturned && (
                              <Badge className="bg-orange-100 text-orange-700 border-orange-200 text-xs w-fit">
                                Returned
                              </Badge>
                            )}
                            {item.quantity == null || Number(item.quantity) === 0 ? (
                              <Badge variant="destructive">{t("status.out-of-stock")}</Badge>
                            ) : Number(item.quantity) <= Number(item.reorderPoint || 0) ? (
                              <Badge className="bg-yellow-500">{t("status.low-stock")}</Badge>
                            ) : (
                              <Badge variant="secondary">{t("status.in-stock")}</Badge>
                            )}
                          </div>
                        </TableCell>
                        <TableCell>
                          {item.isReturned && (
                            <Button 
                              variant="destructive" 
                              size="sm" 
                              onClick={() => handleRemoveReturnedItem(item)}
                              className="gap-1"
                            >
                              <X className="w-4 h-4" />
                              Remove
                            </Button>
                          )}
                          {!item.isReturned && (
                            <span className="text-xs text-muted-foreground">—</span>
                          )}
                        </TableCell>
                        <TableCell>
                          <Button variant="outline" size="sm" onClick={() => handleViewPhotos(item)} className="gap-1">
                            <Camera className="w-4 h-4" />
                            {t("photo.view")}
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Pending Inventory Tab */}
        <TabsContent value="pending" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>{t("inventory.pending-items")}</CardTitle>
              <CardDescription>{t("inventory.pending-description")}</CardDescription>
            </CardHeader>
            <CardContent>
              {pendingItems.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-12 text-center">
                  <Package className="w-12 h-12 text-muted-foreground mb-4" />
                  <p className="text-muted-foreground">{t("inventory.no-pending-items")}</p>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>{t("field.product-name")}</TableHead>
                        <TableHead>{t("field.sku")}</TableHead>
                        <TableHead>{t("field.quantity")}</TableHead>
                        <TableHead>{t("field.unit-price")}</TableHead>
                        <TableHead>{t("field.total")}</TableHead>
                        <TableHead>{t("field.so-number")}</TableHead>
                        <TableHead>{t("field.customer")}</TableHead>
                        <TableHead>{t("field.status")}</TableHead>
                        <TableHead>{t("field.actions")}</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {pendingItems.map((item) => (
                        <TableRow key={item.id}>
                          <TableCell className="font-medium">
                            <div className="flex items-center gap-2">
                              <span>{item.productName}</span>
                              {!item.productId && (
                                <Badge variant="secondary" className="text-xs bg-purple-100 text-purple-700 border-purple-200">
                                  Outsourced
                                </Badge>
                              )}
                            </div>
                          </TableCell>
                          <TableCell>{item.sku}</TableCell>
                          <TableCell>{formatNumber(item.quantity)}</TableCell>
                          <TableCell>{formatCurrency(item.unitPrice)}</TableCell>
                          <TableCell>{formatCurrency(item.total)}</TableCell>
                          <TableCell>{item.soNumber}</TableCell>
                          <TableCell>{item.customerName}</TableCell>
                          <TableCell>
                            <Badge variant="outline" className="bg-yellow-50 text-yellow-700 border-yellow-300">
                              <Clock className="w-3 h-3 mr-1" />
                              {t("inventory.awaiting-dp")}
                            </Badge>
                          </TableCell>
                          <TableCell>
                            <Button variant="ghost" size="sm" onClick={() => handleViewSODetails(item)}>
                              <Eye className="w-4 h-4 mr-1" />
                              {t("action.view")}
                            </Button>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Sold Inventory Tab */}
        <TabsContent value="sold" className="space-y-4">
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle>{t("inventory.sold-items")}</CardTitle>
                  <CardDescription>{t("inventory.sold-description")}</CardDescription>
                </div>
                <div className="flex items-center gap-4">
                  <div className="flex items-center gap-2">
                    <Label className="text-sm whitespace-nowrap">{t("field.from")}:</Label>
                    <Input
                      type="date"
                      value={soldDateFrom}
                      onChange={(e) => setSoldDateFrom(e.target.value)}
                      className="w-[150px]"
                    />
                  </div>
                  <div className="flex items-center gap-2">
                    <Label className="text-sm whitespace-nowrap">{t("field.to")}:</Label>
                    <Input
                      type="date"
                      value={soldDateTo}
                      onChange={(e) => setSoldDateTo(e.target.value)}
                      className="w-[150px]"
                    />
                  </div>
                  {(soldDateFrom || soldDateTo) && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => {
                        setSoldDateFrom("")
                        setSoldDateTo("")
                      }}
                    >
                      <X className="w-4 h-4 mr-1" />
                      {t("action.clear")}
                    </Button>
                  )}
                </div>
              </div>
            </CardHeader>
            <CardContent>
              {soldItems.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-12 text-center">
                  <CheckCircle className="w-12 h-12 text-muted-foreground mb-4" />
                  <p className="text-muted-foreground">{t("inventory.no-sold-items")}</p>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>{t("field.product-name")}</TableHead>
                        <TableHead>{t("field.sku")}</TableHead>
                        <TableHead>{t("field.quantity")}</TableHead>
                        <TableHead>{t("field.unit-price")}</TableHead>
                        <TableHead>{t("field.total")}</TableHead>
                        <TableHead>{t("field.so-number")}</TableHead>
                        <TableHead>{t("field.customer")}</TableHead>
                        <TableHead>{t("inventory.sold-date")}</TableHead>
                        <TableHead>{t("field.actions")}</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {soldItems.map((item) => (
                        <TableRow key={item.id}>
                          <TableCell className="font-medium">
                            <div className="flex items-center gap-2">
                              <span>{item.productName}</span>
                              {!item.productId && (
                                <Badge variant="secondary" className="text-xs bg-purple-100 text-purple-700 border-purple-200">
                                  Outsourced
                                </Badge>
                              )}
                            </div>
                          </TableCell>
                          <TableCell>{item.sku}</TableCell>
                          <TableCell>{formatNumber(item.quantity)}</TableCell>
                          <TableCell>{formatCurrency(item.unitPrice)}</TableCell>
                          <TableCell>{formatCurrency(item.total)}</TableCell>
                          <TableCell>{item.soNumber}</TableCell>
                          <TableCell>{item.customerName}</TableCell>
                          <TableCell>{formatDate(item.soldDate)}</TableCell>
                          <TableCell>
                            <Button variant="ghost" size="sm" onClick={() => handleViewSODetails(item)}>
                              <Eye className="w-4 h-4 mr-1" />
                              {t("action.view")}
                            </Button>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Returns Tab */}
        <TabsContent value="returns" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <RotateCcw className="w-5 h-5" />
                Returned Items
              </CardTitle>
              <CardDescription>
                Items returned from customers currently held in the warehouse. Remove an item to write it off and add a credit to the supplier account.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {returnedItems.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-12 text-center">
                  <RotateCcw className="w-12 h-12 text-muted-foreground mb-4" />
                  <p className="text-muted-foreground">No returned items in inventory</p>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>{t("field.product-name")}</TableHead>
                        <TableHead>{t("field.sku")}</TableHead>
                        <TableHead>{t("field.quantity")}</TableHead>
                        <TableHead>{t("field.unit-cost")}</TableHead>
                        <TableHead>Total Value</TableHead>
                        <TableHead>Supplier</TableHead>
                        <TableHead>SO Number</TableHead>
                        <TableHead>{t("warehouse.warehouse")}</TableHead>
                        <TableHead>{t("field.actions")}</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {returnedItems.map((item: any) => (
                        <TableRow key={item.id}>
                          <TableCell className="font-medium">
                            <div className="flex items-center gap-2">
                              <span>{item.productName}</span>
                              {item.isOutsourced && (
                                <Badge variant="secondary" className="text-xs bg-purple-100 text-purple-700 border-purple-200">
                                  Outsourced
                                </Badge>
                              )}
                              <Badge variant="secondary" className="text-xs bg-amber-100 text-amber-700 border-amber-200">
                                Returned
                              </Badge>
                            </div>
                          </TableCell>
                          <TableCell>{item.sku || "—"}</TableCell>
                          <TableCell>{formatNumber(item.quantity)}</TableCell>
                          <TableCell>{formatCurrency(item.unitCost || 0)}</TableCell>
                          <TableCell>{formatCurrency((item.quantity || 0) * (item.unitCost || 0))}</TableCell>
                          <TableCell>{item.supplierName || "—"}</TableCell>
                          <TableCell>{item.soNumber || "—"}</TableCell>
                          <TableCell>{item.warehouseName || "—"}</TableCell>
                          <TableCell>
                            <Button
                              variant="destructive"
                              size="sm"
                              onClick={() => handleRemoveReturnedItem(item)}
                              className="gap-1"
                            >
                              <X className="w-4 h-4" />
                              Remove & Credit
                            </Button>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* AI Insights Dialog */}
      <Dialog open={showAiInsights} onOpenChange={setShowAiInsights}>
        <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Sparkles className="w-5 h-5 text-yellow-500" />
              {t("inventory.ai-insights")}
            </DialogTitle>
          </DialogHeader>
          {aiAnalysis && (
            <div className="space-y-4">
              <div className="prose prose-sm max-w-none" dangerouslySetInnerHTML={{ __html: aiAnalysis }} />
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Photo Dialog */}
      <Dialog open={showPhotoDialog} onOpenChange={setShowPhotoDialog}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>
              {t("photo.photos")} - {selectedProductForPhoto?.productName}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            {productImages.length > 0 ? (
              <div className="space-y-4">
                <div className="relative aspect-video bg-muted rounded-lg overflow-hidden">
                  <img
                    src={productImages[selectedImageIndex]?.image_url || "/placeholder.svg"}
                    alt={selectedProductForPhoto?.productName}
                    className="w-full h-full object-contain"
                    onError={(e) => {
                      console.error("[v0] Image failed to load:", productImages[selectedImageIndex]?.image_url)
                      e.currentTarget.src = "/placeholder.svg"
                    }}
                  />
                  {productImages.length > 1 && (
                    <>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="absolute left-2 top-1/2 -translate-y-1/2"
                        onClick={() =>
                          setSelectedImageIndex((prev) => (prev > 0 ? prev - 1 : productImages.length - 1))
                        }
                      >
                        <ChevronLeft className="w-6 h-6" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="absolute right-2 top-1/2 -translate-y-1/2"
                        onClick={() =>
                          setSelectedImageIndex((prev) => (prev < productImages.length - 1 ? prev + 1 : 0))
                        }
                      >
                        <ChevronRight className="w-6 h-6" />
                      </Button>
                    </>
                  )}
                </div>
                <div className="flex gap-2 overflow-x-auto py-2">
                  {productImages.map((img, idx) => (
                    <button
                      key={img.image_id}
                      onClick={() => setSelectedImageIndex(idx)}
                      className={`flex-shrink-0 w-16 h-16 rounded-lg overflow-hidden border-2 ${
                        idx === selectedImageIndex ? "border-primary" : "border-transparent"
                      }`}
                    >
                      <img
                        src={img.image_url || "/placeholder.svg"}
                        alt={`${selectedProductForPhoto?.productName} ${idx + 1}`}
                        className="w-full h-full object-cover"
                        onError={(e) => {
                          e.currentTarget.src = "/placeholder.svg"
                        }}
                      />
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center py-12">
                <ImageIcon className="w-16 h-16 text-muted-foreground mb-4" />
                <p className="text-muted-foreground">{t("photo.no-photos")}</p>
              </div>
            )}
            <div className="flex justify-between items-center pt-4 border-t">
              <label className="cursor-pointer">
                <input type="file" accept="image/*" className="hidden" onChange={handlePhotoUpload} />
                <Button variant="outline" disabled={isUploadingPhoto} asChild>
                  <span>
                    {isUploadingPhoto ? (
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    ) : (
                      <Camera className="w-4 h-4 mr-2" />
                    )}
                    {t("photo.upload")}
                  </span>
                </Button>
              </label>
              <Button variant="outline" onClick={() => setShowPhotoDialog(false)}>
                {t("action.close")}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Remove Returned Item Dialog */}
      <Dialog open={removeReturnedItemDialog} onOpenChange={setRemoveReturnedItemDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Remove Returned Item</DialogTitle>
          </DialogHeader>
          {selectedReturnedItem && (
            <div className="space-y-4">
              <div className="bg-amber-50 border border-amber-200 rounded-lg p-4">
                <p className="text-sm text-amber-900">
                  <strong>Item:</strong> {selectedReturnedItem.productName}
                </p>
                <p className="text-sm text-amber-900 mt-2">
                  <strong>Quantity:</strong> {formatNumber(selectedReturnedItem.quantity)}
                </p>
                <p className="text-sm text-amber-900 mt-2">
                  <strong>Unit Cost:</strong> {formatCurrency(selectedReturnedItem.unitCost || 0)}
                </p>
                <p className="text-sm text-amber-900 mt-2 font-semibold">
                  <strong>Total Credit:</strong> {formatCurrency((selectedReturnedItem.quantity || 0) * (selectedReturnedItem.unitCost || 0))}
                </p>
                {selectedReturnedItem.supplierName && (
                  <p className="text-sm text-amber-900 mt-2">
                    <strong>Supplier:</strong> {selectedReturnedItem.supplierName}
                  </p>
                )}
              </div>
              <p className="text-sm text-muted-foreground">
                This will remove the item from inventory and create a credit memo with the supplier for the total value.
              </p>
              <div className="flex gap-2 justify-end">
                <Button
                  variant="outline"
                  onClick={() => setRemoveReturnedItemDialog(false)}
                  disabled={isRemovingItem}
                >
                  Cancel
                </Button>
                <Button
                  variant="destructive"
                  onClick={handleConfirmRemoveReturnedItem}
                  disabled={isRemovingItem}
                >
                  {isRemovingItem ? (
                    <>
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                      Processing...
                    </>
                  ) : (
                    "Remove & Create Credit"
                  )}
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* SO Details Dialog */}
      <Dialog open={showSODetailsDialog} onOpenChange={setShowSODetailsDialog}>
        <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              {t("so.title")} - {selectedSODetails?.soNumber}
            </DialogTitle>
          </DialogHeader>
          {selectedSODetails && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4 p-4 bg-muted/30 rounded-lg">
                <div>
                  <p className="text-sm text-muted-foreground">{t("field.so-number")}</p>
                  <p className="font-medium">{selectedSODetails.soNumber}</p>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">{t("field.date")}</p>
                  <p className="font-medium">{formatDate(selectedSODetails.orderDate)}</p>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">{t("field.customer")}</p>
                  <p className="font-medium">
                    {customers.find((c) => c.id === selectedSODetails.customerId)?.name || "Unknown"}
                  </p>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">{t("field.total")}</p>
                  <p className="font-medium text-lg">{formatCurrency(selectedSODetails.total)}</p>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">{t("field.status")}</p>
                  <Badge>{selectedSODetails.status}</Badge>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">{t("payment.type")}</p>
                  <p className="font-medium">{selectedSODetails.paymentType || "-"}</p>
                </div>
              </div>
              <div>
                <h4 className="font-semibold mb-2">{t("field.items")}</h4>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{t("field.product")}</TableHead>
                      <TableHead>{t("field.quantity")}</TableHead>
                      <TableHead>{t("field.unit-price")}</TableHead>
                      <TableHead>{t("field.total")}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {selectedSODetails.items?.map((item, idx) => (
                      <TableRow key={idx}>
                        <TableCell>
                          {item.productName || products.find((p) => p.id === item.productId)?.productName || "-"}
                        </TableCell>
                        <TableCell>{formatNumber(item.quantity)}</TableCell>
                        <TableCell>{formatCurrency(item.unitPrice)}</TableCell>
                        <TableCell>{formatCurrency(item.total)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Add Warehouse Dialog */}
      <Dialog open={showAddWarehouseDialog} onValueChange={setShowAddWarehouseDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Warehouse className="w-5 h-5" />
              Add New Warehouse
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="warehouse-name">Warehouse Name *</Label>
              <Input
                id="warehouse-name"
                value={newWarehouseName}
                onChange={(e) => setNewWarehouseName(e.target.value)}
                placeholder="e.g., Main Warehouse"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="warehouse-location">Location</Label>
              <Input
                id="warehouse-location"
                value={newWarehouseLocation}
                onChange={(e) => setNewWarehouseLocation(e.target.value)}
                placeholder="e.g., North Wing"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="warehouse-address">Address</Label>
              <Textarea
                id="warehouse-address"
                value={newWarehouseAddress}
                onChange={(e) => setNewWarehouseAddress(e.target.value)}
                placeholder="Full address..."
                rows={2}
              />
            </div>
          </div>
          <div className="flex justify-end gap-2">
            <Button
              variant="outline"
              onClick={() => {
                setShowAddWarehouseDialog(false)
                setNewWarehouseName("")
                setNewWarehouseLocation("")
                setNewWarehouseAddress("")
              }}
            >
              Cancel
            </Button>
            <Button onClick={handleCreateWarehouse} disabled={!newWarehouseName.trim() || isCreatingWarehouse}>
              {isCreatingWarehouse ? "Creating..." : "Create Warehouse"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Add Category Dialog */}
      <Dialog open={showAddCategoryDialog} onOpenChange={setShowAddCategoryDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create New Category</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="category-name">Category Name *</Label>
              <Input
                id="category-name"
                value={newCategoryName}
                onChange={(e) => setNewCategoryName(e.target.value)}
                placeholder="e.g., Electronics, Food, etc."
              />
            </div>
          </div>
          <div className="flex justify-end gap-2">
            <Button
              variant="outline"
              onClick={() => {
                setShowAddCategoryDialog(false)
                setNewCategoryName("")
              }}
            >
              Cancel
            </Button>
            <Button onClick={handleCreateCategory} disabled={!newCategoryName.trim() || isCreatingCategory}>
              {isCreatingCategory ? "Creating..." : "Create Category"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
