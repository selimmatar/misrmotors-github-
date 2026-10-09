"use client"

import { useState, useEffect } from "react"
import { useAppContext } from "@/lib/app-context"
import { useI18n } from "@/lib/i18n-context"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Package, Truck, CheckCircle, RefreshCw, Printer, Eye, X, Warehouse, Plus, MapPin, Phone, User, RotateCcw } from "lucide-react"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { PageHeader } from "@/components/erp/page-header"
import { StatusBadge } from "@/components/erp/status-badge"
import { formatDate } from "@/lib/format"
import type { DeliveryPermit } from "@/lib/types"

interface WarehouseAvailability {
  warehouseId: string
  warehouseName: string
  availableQuantity: number
}

interface ItemAllocation {
  itemId: number
  productId: string
  productName: string
  sku: string
  totalQuantity: number
  unit: string
  availableWarehouses: WarehouseAvailability[]
  isOutsourced?: boolean
  allocations: {
    warehouseId: string
    warehouseName: string
    quantity: number
  }[]
}

export function WarehouseDeliveryModule() {
  const { user, warehouses, refreshInventory } = useAppContext()
  const { t, formatNumber, language } = useI18n()
  const [permits, setPermits] = useState<DeliveryPermit[]>([])
  const [loading, setLoading] = useState(true)
  const [previewPermit, setPreviewPermit] = useState<DeliveryPermit | null>(null)
  const [showPreview, setShowPreview] = useState(false)
  const [showAllocationDialog, setShowAllocationDialog] = useState(false)
  const [selectedPermitForAllocation, setSelectedPermitForAllocation] = useState<DeliveryPermit | null>(null)
  const [itemAllocations, setItemAllocations] = useState<ItemAllocation[]>([])
  const [allocationNotes, setAllocationNotes] = useState("")
  const [savingAllocation, setSavingAllocation] = useState(false)
  
  // Returns state
  const [pendingReturns, setPendingReturns] = useState<any[]>([])
  const [showReturnProcessDialog, setShowReturnProcessDialog] = useState(false)
  const [selectedReturn, setSelectedReturn] = useState<any>(null)
  const [returnWarehouseSelections, setReturnWarehouseSelections] = useState<Record<string, string>>({})
  const [processingReturn, setProcessingReturn] = useState(false)

  useEffect(() => {
    fetchPermits()
    fetchPendingReturns()
  }, [])
  
  const fetchPendingReturns = async () => {
    try {
      const response = await fetch("/api/returns?status=pending_warehouse")
      if (response.ok) {
        const data = await response.json()
        setPendingReturns(data)
      }
    } catch (error) {
      console.error("Error fetching returns:", error)
    }
  }

  const fetchPermits = async () => {
    try {
      setLoading(true)
      const response = await fetch("/api/delivery-permits")
      if (response.ok) {
        const data = await response.json()
        setPermits(data)
      }
    } catch (error) {
      console.error("Error fetching permits:", error)
    } finally {
      setLoading(false)
    }
  }

  const draftPermits = permits.filter((p) => p.status === "DRAFT")
  const readyForShipmentPermits = permits.filter((p) => p.status === "READY_FOR_SHIPMENT")
  const readyPermits = permits.filter((p) => p.status === "READY_FOR_PICKUP" || p.status === "PRINTED")
  const completedPermits = permits.filter(
    (p) => p.status === "OUT_FOR_DELIVERY" || p.status === "SUBMITTED_SIGNED" || p.status === "APPROVED",
  )

  const openAllocationDialog = async (permit: DeliveryPermit) => {
    try {
      const [inventoryResponse, suppliersResponse] = await Promise.all([
        fetch("/api/inventory"),
        fetch("/api/suppliers")
      ])
      
      const inventoryData = inventoryResponse.ok ? await inventoryResponse.json() : []
      const suppliersData = suppliersResponse.ok ? await suppliersResponse.json() : []
      
      const allocations: ItemAllocation[] = (permit.items || []).map((item: any) => {
        const productId = item.productId || item.product_id
        const isOutsourced = !productId || productId === "" || productId === "null"
        
        // For outsourced items, use supplier info; for regular items, use warehouse info
        let availableWarehouses: WarehouseAvailability[] = []
        let defaultWh = null
        
        if (!isOutsourced) {
          // Find all warehouses that have this product in stock
          const productInventory = inventoryData.filter((inv: any) => 
            String(inv.productId) === String(productId) && inv.quantity > 0
          )
          
          availableWarehouses = productInventory.map((inv: any) => ({
            warehouseId: String(inv.warehouseId),
            warehouseName: inv.warehouseName || warehouses.find(w => w.id === inv.warehouseId)?.name || `Warehouse ${inv.warehouseId}`,
            availableQuantity: inv.quantity
          }))
          
          // Default to first available warehouse with sufficient stock
          defaultWh = availableWarehouses.find(w => w.availableQuantity >= item.quantity) || availableWarehouses[0]
        } else {
          // For outsourced items, find the supplier from the sales order
          // We need to get supplier info from the permit's sales order data
          
          // Create a virtual "warehouse" entry for the supplier
          // We'll store the supplier name in warehouseName and use a special ID format
          // API returns: supplierName (from suppliers table join), outsourcedName (item name)
          // If no supplier linked, show "External Supplier" instead of product name
          const supplierName = item.supplierName || "External Supplier"
          const supplierId = item.supplierId || "outsourced"
          
          
          availableWarehouses = [{
            warehouseId: `supplier_${supplierId}`,
            warehouseName: supplierName,
            availableQuantity: item.quantity // Mark as "available" since it's outsourced
          }]
          defaultWh = availableWarehouses[0]
          
        }
        
        return {
          itemId: item.id,
          productId: productId || "",
          productName: item.itemNameSnapshot || item.productName,
          sku: item.skuSnapshot || item.sku || "",
          totalQuantity: item.quantity,
          unit: item.unitSnapshot || item.unit || "unit",
          availableWarehouses,
          isOutsourced,
          allocations: item.warehouseId ? [{
            warehouseId: String(item.warehouseId),
            warehouseName: item.isOutsourced 
              ? (item.supplierName || "External Supplier")
              : (warehouses.find(w => w.id === item.warehouseId)?.name || ""),
            quantity: item.allocatedQuantity || item.quantity
          }] : defaultWh ? [{
            warehouseId: defaultWh.warehouseId,
            warehouseName: defaultWh.warehouseName,
            quantity: item.quantity
          }] : []
        }
      })
      
      setItemAllocations(allocations)
      setAllocationNotes("")
      setSelectedPermitForAllocation(permit)
      setShowAllocationDialog(true)
    } catch (error) {
      console.error("Error fetching inventory:", error)
      alert("Failed to load inventory data")
    }
  }

  const handleSaveAllocations = async () => {
    if (!selectedPermitForAllocation) return
    
    // Validate all items have allocations matching their quantities
    for (const item of itemAllocations) {
      const totalAllocated = item.allocations.reduce((sum, a) => sum + a.quantity, 0)
      if (totalAllocated !== item.totalQuantity) {
        alert(`${item.productName}: Allocated ${totalAllocated} but need ${item.totalQuantity}`)
        return
      }
    }

    setSavingAllocation(true)
    try {
      const response = await fetch("/api/delivery-permits", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          permitId: selectedPermitForAllocation.id,
          action: "ALLOCATE_WAREHOUSES",
          userId: user?.id,
          allocations: itemAllocations.flatMap(item => 
            item.allocations.map(alloc => ({
              itemId: item.itemId,
              warehouseId: parseInt(alloc.warehouseId),
              quantity: alloc.quantity
            }))
          ),
          notes: allocationNotes,
        }),
      })

      if (response.ok) {
        await fetchPermits()
        setShowAllocationDialog(false)
        setSelectedPermitForAllocation(null)
        alert("Warehouse allocations saved and marked ready for shipment!")
      } else {
        const error = await response.json()
        alert(error.error || "Failed to save allocations")
      }
    } catch (error) {
      console.error("Error saving allocations:", error)
      alert("Failed to save allocations")
    } finally {
      setSavingAllocation(false)
    }
  }

  const handleMarkReady = async (permit: DeliveryPermit) => {
    try {
      const response = await fetch("/api/delivery-permits", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          permitId: permit.id,
          action: "MARK_READY_FOR_PICKUP",
          userId: user?.id,
        }),
      })

      if (response.ok) {
        fetchPermits()
        alert(t("message.success"))
      } else {
        const error = await response.json()
        alert(error.error || t("message.error"))
      }
    } catch (error) {
      alert(t("message.error"))
    }
  }

  const handlePrint = (permit: DeliveryPermit) => {
    const url = `${window.location.origin}/api/delivery-permits/pdf?permitId=${permit.id}`
    window.open(url, "_blank")
  }

  const handleViewPermit = (permit: DeliveryPermit) => {
    setPreviewPermit(permit)
    setShowPreview(true)
  }

  // Label for the permit status badge. READY_FOR_SHIPMENT and unknown values use the default StatusBadge label.
  const getPermitLabel = (status: string): string | undefined => {
    switch (status) {
      case "DRAFT":
        return t("permit.status.draft")
      case "READY_FOR_PICKUP":
        return t("permit.status.ready-for-pickup")
      case "OUT_FOR_DELIVERY":
        return t("permit.status.out-for-delivery")
      case "SUBMITTED_SIGNED":
      case "APPROVED":
        return t("permit.status.completed")
      default:
        return undefined
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader
        group={t("group.operations")}
        title={t("warehouse.delivery-management")}
        subtitle={t("warehouse.delivery-description")}
        actions={
          <Button variant="outline" onClick={fetchPermits} disabled={loading}>
            <RefreshCw className={`w-4 h-4 me-2 ${loading ? "animate-spin" : ""}`} />
            {t("action.refresh")}
          </Button>
        }
      />

      <Tabs defaultValue="pending" className="space-y-4">
        <TabsList className="h-auto flex-wrap w-full justify-start">
          <TabsTrigger value="pending">
            Pending Allocation ({formatNumber(draftPermits.length)})
          </TabsTrigger>
          <TabsTrigger value="ready-shipment">
            Ready for Shipment ({formatNumber(readyForShipmentPermits.length)})
          </TabsTrigger>
          <TabsTrigger value="ready">
            {t("warehouse.ready-for-pickup")} ({formatNumber(readyPermits.length)})
          </TabsTrigger>
          <TabsTrigger value="returns" className="text-orange-700">
            Returns ({formatNumber(pendingReturns.length)})
          </TabsTrigger>
          <TabsTrigger value="completed">
            {t("warehouse.completed")} ({formatNumber(completedPermits.length)})
          </TabsTrigger>
        </TabsList>

        {/* Pending Allocation Tab */}
        <TabsContent value="pending" className="space-y-4">
          {loading ? (
            <Card>
              <CardContent className="py-8 text-center">{t("loading")}...</CardContent>
            </Card>
          ) : draftPermits.length === 0 ? (
            <Card>
              <CardContent className="flex flex-col items-center justify-center py-12">
                <Package className="w-12 h-12 text-muted-foreground mb-4" />
                <p className="text-muted-foreground">{t("warehouse.no-pending-permits")}</p>
              </CardContent>
            </Card>
          ) : (
            <div className="grid gap-4">
              {draftPermits.map((permit) => (
                <Card key={permit.id}>
                  <CardHeader>
                    <div className="flex items-start justify-between flex-wrap gap-2">
                      <div className="min-w-0 break-words">
                        <CardTitle className="flex items-center gap-2">
                          {permit.permitNo}
                          <StatusBadge status={permit.status} label={getPermitLabel(permit.status)} />
                        </CardTitle>
                        <p className="text-sm text-muted-foreground mt-1">
                          {t("field.so-number")}: {permit.soNumber} | {t("field.customer")}: {permit.customerName}
                        </p>
                      </div>
                      <div className="text-end">
                        <p className="text-sm text-muted-foreground">
                          {t("field.date")}: {formatDate(permit.createdAt || "", language)}
                        </p>
                      </div>
                    </div>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-4">
                      <div className="border rounded-lg p-3 bg-muted/30">
                        <p className="text-sm font-medium mb-2">
                          {t("permit.items")} ({permit.items?.length || 0}):
                        </p>
                        <ul className="space-y-1">
                          {(permit.items || []).slice(0, 3).map((item: any, idx: number) => (
                            <li key={idx} className="text-sm flex justify-between">
                              <span>{item.itemNameSnapshot}</span>
                              <span className="font-medium">
                                {formatNumber(item.quantity)} {item.unitSnapshot}
                              </span>
                            </li>
                          ))}
                          {(permit.items?.length || 0) > 3 && (
                            <li className="text-sm text-muted-foreground">
                              +{(permit.items?.length || 0) - 3} more items...
                            </li>
                          )}
                        </ul>
                      </div>

                      <div className="flex flex-wrap gap-2">
                        <Button
                          onClick={() => openAllocationDialog(permit)}
                          className="flex-1 bg-blue-600 hover:bg-blue-700"
                        >
                          <Warehouse className="w-4 h-4 me-2" />
                          Allocate Warehouses & Prepare
                        </Button>
                        <Button variant="outline" onClick={() => handleViewPermit(permit)}>
                          <Eye className="w-4 h-4 me-2" />
                          {t("action.view")}
                        </Button>
                        <Button variant="outline" onClick={() => handlePrint(permit)}>
                          <Printer className="w-4 h-4 me-2" />
                          {t("action.print")}
                        </Button>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </TabsContent>

        {/* Ready for Shipment Tab */}
        <TabsContent value="ready-shipment" className="space-y-4">
          {loading ? (
            <Card>
              <CardContent className="py-8 text-center">{t("loading")}...</CardContent>
            </Card>
          ) : readyForShipmentPermits.length === 0 ? (
            <Card>
              <CardContent className="flex flex-col items-center justify-center py-12">
                <Truck className="w-12 h-12 text-muted-foreground mb-4" />
                <p className="text-muted-foreground">No permits ready for shipment</p>
              </CardContent>
            </Card>
          ) : (
            <div className="grid gap-4">
              {readyForShipmentPermits.map((permit) => (
                <Card key={permit.id} className="border-purple-200 bg-purple-50/30">
                  <CardHeader>
                    <div className="flex items-start justify-between flex-wrap gap-2">
                      <div className="min-w-0 break-words">
                        <CardTitle className="flex items-center gap-2">
                          {permit.permitNo}
                          <StatusBadge status={permit.status} label={getPermitLabel(permit.status)} />
                        </CardTitle>
                        <p className="text-sm text-muted-foreground mt-1">
                          {t("field.so-number")}: {permit.soNumber} | {t("field.customer")}: {permit.customerName}
                        </p>
                      </div>
                      <div className="text-end">
                        <p className="text-sm text-muted-foreground">
                          {t("field.date")}: {formatDate(permit.createdAt || "", language)}
                        </p>
                      </div>
                    </div>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-4">
                      {/* Collection Details */}
                      <div className="bg-white border rounded-lg p-4 space-y-3">
                        <h4 className="font-semibold text-sm flex items-center gap-2">
                          <Truck className="w-4 h-4" />
                          Collection Details
                        </h4>
                        
                        <div className="grid grid-cols-2 gap-4 text-sm">
                          <div className="flex items-start gap-2">
                            <User className="w-4 h-4 text-muted-foreground mt-0.5" />
                            <div>
                              <p className="text-muted-foreground">Recipient</p>
                              <p className="font-medium">{permit.recipientName || permit.customerName || "Not specified"}</p>
                            </div>
                          </div>
                          <div className="flex items-start gap-2">
                            <Phone className="w-4 h-4 text-muted-foreground mt-0.5" />
                            <div>
                              <p className="text-muted-foreground">Contact</p>
                              <p className="font-medium">{permit.recipientPhone || permit.customerPhone || "Not specified"}</p>
                            </div>
                          </div>
                        </div>
                        
                        <div className="flex items-start gap-2 text-sm">
                          <MapPin className="w-4 h-4 text-muted-foreground mt-0.5" />
                          <div>
                            <p className="text-muted-foreground">Delivery Address</p>
                            <p className="font-medium">
                              {permit.deliveryAddress || 
                               (permit.customerAddress ? 
                                 `${permit.customerAddress}${permit.customerCity ? ', ' + permit.customerCity : ''}${permit.customerCountry ? ', ' + permit.customerCountry : ''}` 
                                 : "Not specified")}
                            </p>
                          </div>
                        </div>
                      </div>

                      {/* Items with Warehouse Allocations */}
                      <div className="border rounded-lg p-3 bg-muted/30">
                        <p className="text-sm font-medium mb-2 flex items-center gap-2">
                          <Package className="w-4 h-4" />
                          Items to Collect:
                        </p>
                        <div className="space-y-2">
                          {(() => {
                            // Group items by product
                            const groupedItems: Record<string, any[]> = {}
                            ;(permit.items || []).forEach((item: any) => {
                              const key = `${item.productId}-${item.itemNameSnapshot}`
                              if (!groupedItems[key]) {
                                groupedItems[key] = []
                              }
                              groupedItems[key].push(item)
                            })
                            
                            return Object.values(groupedItems).map((itemGroup: any[], idx: number) => {
                              const firstItem = itemGroup[0]
                              const totalQty = itemGroup.reduce((sum, i) => sum + (i.allocatedQuantity || i.quantity), 0)
                              const isOutsourced = !firstItem.productId || firstItem.productId === "" || firstItem.productId === "null"
                              
                              return (
                                <div key={idx} className="bg-white p-2 rounded border space-y-1">
                                  <div className="flex justify-between items-center text-sm">
                                    <div className="flex items-center gap-2">
                                      <span className="font-medium">{firstItem.itemNameSnapshot}</span>
                                      {firstItem.skuSnapshot && (
                                        <span className="text-muted-foreground">({firstItem.skuSnapshot})</span>
                                      )}
                                      {isOutsourced && (
                                        <Badge variant="secondary" className="bg-amber-50 text-amber-700 border-amber-300 text-xs">
                                          Outsourced
                                        </Badge>
                                      )}
                                    </div>
                                    <span className="font-medium">
                                      {formatNumber(totalQty)} {firstItem.unitSnapshot}
                                    </span>
                                  </div>
                                  {/* Show warehouse allocations or supplier name */}
                                  {itemGroup.length > 1 && (
                                    <div className="flex flex-wrap gap-1 ps-4">
                                      {itemGroup.map((item: any, wIdx: number) => {
                                        const whId = String(item.warehouseId || '')
                                        return (
                                          <Badge key={wIdx} variant="outline" className={`text-xs ${isOutsourced ? 'bg-amber-50 text-amber-700 border-amber-300' : 'bg-blue-50'}`}>
                                            {isOutsourced ? (
                                              <>
                                                <span className="me-1">Supplier:</span>
                                                {whId.startsWith('supplier_') 
                                                  ? (item.supplierName || "External Supplier")
                                                  : (warehouses.find(w => w.id === item.warehouseId)?.name || `WH-${item.warehouseId}`)
                                                }
                                              </>
                                            ) : (
                                              <>
                                                <Warehouse className="w-3 h-3 me-1" />
                                                {warehouses.find(w => w.id === item.warehouseId)?.name || `WH-${item.warehouseId}`}: {formatNumber(item.allocatedQuantity || item.quantity)} {item.unitSnapshot}
                                              </>
                                            )}: {formatNumber(item.allocatedQuantity || item.quantity)} {item.unitSnapshot}
                                          </Badge>
                                        )
                                      })}
                                    </div>
                                  )}
                                  {itemGroup.length === 1 && itemGroup[0].warehouseId && (
                                    <div className="ps-4">
                                      {(() => {
                                        const whId = String(itemGroup[0].warehouseId || '')
                                        return (
                                          <Badge variant="outline" className={`text-xs ${isOutsourced ? 'bg-amber-50 text-amber-700 border-amber-300' : 'bg-blue-50'}`}>
                                            {isOutsourced ? (
                                              <>
                                                <span className="me-1">Supplier:</span>
                                                {whId.startsWith('supplier_') 
                                                  ? (itemGroup[0].supplierName || "External Supplier")
                                                  : (warehouses.find(w => w.id === itemGroup[0].warehouseId)?.name || `WH-${itemGroup[0].warehouseId}`)
                                                }
                                              </>
                                            ) : (
                                              <>
                                                <Warehouse className="w-3 h-3 me-1" />
                                                {warehouses.find(w => w.id === itemGroup[0].warehouseId)?.name || `WH-${itemGroup[0].warehouseId}`}
                                              </>
                                            )}
                                          </Badge>
                                        )
                                      })()}
                                    </div>
                                  )}
                                </div>
                              )
                            })
                          })()}
                        </div>
                      </div>

                      <div className="flex flex-wrap gap-2">
                        <Button
                          onClick={() => handleMarkReady(permit)}
                          className="flex-1 bg-green-600 hover:bg-green-700"
                        >
                          <CheckCircle className="w-4 h-4 me-2" />
                          Mark as Picked Up / Ready for Delivery
                        </Button>
                        <Button variant="outline" onClick={() => handleViewPermit(permit)}>
                          <Eye className="w-4 h-4 me-2" />
                          {t("action.view")}
                        </Button>
                        <Button variant="outline" onClick={() => handlePrint(permit)}>
                          <Printer className="w-4 h-4 me-2" />
                          {t("action.print")}
                        </Button>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </TabsContent>

        {/* Ready for Pickup Tab */}
        <TabsContent value="ready" className="space-y-4">
          {loading ? (
            <Card>
              <CardContent className="py-8 text-center">{t("loading")}...</CardContent>
            </Card>
          ) : readyPermits.length === 0 ? (
            <Card>
              <CardContent className="flex flex-col items-center justify-center py-12">
                <Truck className="w-12 h-12 text-muted-foreground mb-4" />
                <p className="text-muted-foreground">{t("warehouse.no-ready-permits")}</p>
              </CardContent>
            </Card>
          ) : (
            <div className="grid gap-4">
              {readyPermits.map((permit) => (
                <Card key={permit.id} className="border-yellow-200 bg-yellow-50/30">
                  <CardHeader>
                    <div className="flex items-start justify-between flex-wrap gap-2">
                      <div className="min-w-0 break-words">
                        <CardTitle className="flex items-center gap-2">
                          {permit.permitNo}
                          <StatusBadge status={permit.status} label={getPermitLabel(permit.status)} />
                        </CardTitle>
                        <p className="text-sm text-muted-foreground mt-1">
                          {t("field.so-number")}: {permit.soNumber} | {t("field.customer")}: {permit.customerName}
                        </p>
                      </div>
                    </div>
                  </CardHeader>
                  <CardContent>
                    <div className="flex flex-wrap gap-2">
                      <Button variant="outline" onClick={() => handleViewPermit(permit)}>
                        <Eye className="w-4 h-4 me-2" />
                        {t("action.view")}
                      </Button>
                      <Button variant="outline" onClick={() => handlePrint(permit)}>
                        <Printer className="w-4 h-4 me-2" />
                        {t("action.print")}
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </TabsContent>

        {/* Returns Tab */}
        <TabsContent value="returns" className="space-y-4">
          {loading ? (
            <Card>
              <CardContent className="py-8 text-center">{t("loading")}...</CardContent>
            </Card>
          ) : pendingReturns.length === 0 ? (
            <Card>
              <CardContent className="flex flex-col items-center justify-center py-12">
                <RotateCcw className="w-12 h-12 text-muted-foreground mb-4" />
                <p className="text-muted-foreground">No pending returns to process</p>
                <p className="text-sm text-muted-foreground mt-1">Returns from deliveries will appear here for warehouse assignment</p>
              </CardContent>
            </Card>
          ) : (
            <div className="grid gap-4">
              {pendingReturns.map((returnReq) => (
                <Card key={returnReq.id} className="border-orange-200 bg-orange-50/30">
                  <CardHeader>
                    <div className="flex items-start justify-between flex-wrap gap-2">
                      <div className="min-w-0 break-words">
                        <CardTitle className="flex items-center gap-2">
                          Return #{returnReq.id}
                          <Badge variant="outline" className="bg-orange-100 text-orange-700 border-orange-300">
                            Pending Warehouse Assignment
                          </Badge>
                        </CardTitle>
                        <p className="text-sm text-muted-foreground mt-1">
                          SO: {returnReq.soNumber || "N/A"} | Customer: {returnReq.customerName || "Unknown"}
                        </p>
                        <p className="text-sm text-muted-foreground">
                          Courier: {returnReq.courierName || "N/A"} | Initiated by: {returnReq.initiatedBy || returnReq.returnedBy || "shipping"} on {returnReq.createdAt ? formatDate(returnReq.createdAt, language) : "N/A"}
                        </p>
                      </div>
                    </div>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-3">
                      <p className="text-sm font-medium">Items to restock:</p>
                      {returnReq.items?.map((item: any, idx: number) => (
                        <div key={idx} className="flex justify-between items-center text-sm bg-white rounded p-3 border">
                          <div>
                            <span className="font-medium">{item.productName || "Unknown Item"}</span>
                            <span className="text-muted-foreground ms-2">x{item.quantityReturned}</span>
                            {item.isOutsourced && (
                              <Badge variant="outline" className="ms-2 bg-purple-50 text-purple-700 border-purple-300">
                                Outsourced
                              </Badge>
                            )}
                          </div>
                          <div className="flex items-center gap-2">
                            <Badge variant="secondary">{item.reason}</Badge>
                            <Badge variant={item.condition === "good" ? "outline" : "destructive"}>
                              {item.condition}
                            </Badge>
                          </div>
                        </div>
                      ))}
                      {returnReq.notes && (
                        <p className="text-sm text-muted-foreground mt-2 p-2 bg-gray-50 rounded">
                          Notes: {returnReq.notes}
                        </p>
                      )}
                      <Button
                        className="w-full mt-4 bg-orange-600 hover:bg-orange-700"
                        onClick={() => {
                          setSelectedReturn(returnReq)
                          // Initialize warehouse selections for each item
                          const selections: Record<string, string> = {}
                          returnReq.items?.forEach((item: any, idx: number) => {
                            selections[`${idx}`] = ""
                          })
                          setReturnWarehouseSelections(selections)
                          setShowReturnProcessDialog(true)
                        }}
                      >
                        <Warehouse className="w-4 h-4 me-2" />
                        Assign Warehouses & Process Return
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </TabsContent>

        {/* Completed Tab */}
        <TabsContent value="completed" className="space-y-4">
          {loading ? (
            <Card>
              <CardContent className="py-8 text-center">{t("loading")}...</CardContent>
            </Card>
          ) : completedPermits.length === 0 ? (
            <Card>
              <CardContent className="flex flex-col items-center justify-center py-12">
                <CheckCircle className="w-12 h-12 text-muted-foreground mb-4" />
                <p className="text-muted-foreground">{t("warehouse.no-completed-permits")}</p>
              </CardContent>
            </Card>
          ) : (
            <div className="grid gap-4">
              {completedPermits.map((permit) => (
                <Card key={permit.id} className="border-green-200 bg-green-50/30">
                  <CardHeader>
                    <div className="flex items-start justify-between flex-wrap gap-2">
                      <div className="min-w-0 break-words">
                        <CardTitle className="flex items-center gap-2">
                          {permit.permitNo}
                          <StatusBadge status={permit.status} label={getPermitLabel(permit.status)} />
                        </CardTitle>
                        <p className="text-sm text-muted-foreground mt-1">
                          {t("field.so-number")}: {permit.soNumber} | {t("field.customer")}: {permit.customerName}
                        </p>
                      </div>
                    </div>
                  </CardHeader>
                  <CardContent>
                    <Button variant="outline" onClick={() => handleViewPermit(permit)}>
                      <Eye className="w-4 h-4 me-2" />
                      {t("action.view")}
                    </Button>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </TabsContent>
      </Tabs>

      {/* Preview Dialog */}
      <Dialog open={showPreview} onOpenChange={setShowPreview}>
        <DialogContent className="sm:max-w-3xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{previewPermit?.permitNo}</DialogTitle>
          </DialogHeader>
          {previewPermit && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <p className="text-sm text-muted-foreground">{t("field.customer")}</p>
                  <p className="font-medium">{previewPermit.customerName}</p>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">{t("field.so-number")}</p>
                  <p className="font-medium">{previewPermit.soNumber}</p>
                </div>
              </div>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t("field.item")}</TableHead>
                    <TableHead className="text-end">{t("field.quantity")}</TableHead>
                    <TableHead>{t("field.unit")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(previewPermit.items || []).map((item: any, idx: number) => (
                    <TableRow key={idx}>
                      <TableCell>{item.itemNameSnapshot}</TableCell>
                      <TableCell className="text-end">{formatNumber(item.quantity)}</TableCell>
                      <TableCell>{item.unitSnapshot}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Warehouse Allocation Dialog */}
      <Dialog open={showAllocationDialog} onOpenChange={setShowAllocationDialog}>
        <DialogContent className="sm:max-w-4xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Warehouse className="w-5 h-5" />
              Allocate Warehouses - {selectedPermitForAllocation?.permitNo}
            </DialogTitle>
          </DialogHeader>

          {selectedPermitForAllocation && (
            <div className="space-y-6">
              <div className="bg-muted/30 p-4 rounded-lg">
                <p className="text-sm text-muted-foreground">
                  Assign which warehouse(s) each item should be collected from. You can only select warehouses that have the product in stock, and quantities are limited to available stock.
                </p>
              </div>

              <div className="space-y-4">
                {itemAllocations.map((item, itemIndex) => {
                  const usedWarehouseIds = item.allocations.map(a => a.warehouseId)
                  const availableForSplit = item.availableWarehouses.filter(
                    w => !usedWarehouseIds.includes(w.warehouseId)
                  )
                  
                  return (
                    <Card key={item.itemId} className="border-blue-100">
                      <CardHeader className="py-3">
                        <div className="flex items-center justify-between flex-wrap gap-2">
                          <div className="min-w-0 break-words">
                            <CardTitle className="text-base">{item.productName}</CardTitle>
                            {item.sku && <p className="text-sm text-muted-foreground">SKU: {item.sku}</p>}
                            {item.isOutsourced && <p className="text-sm text-amber-700 font-medium">Outsourced Item</p>}
                          </div>
                          <Badge variant="outline" className="text-base">
                            {item.totalQuantity} {item.unit}
                          </Badge>
                        </div>
                        <div className="mt-2 flex flex-wrap gap-1">
                          {item.isOutsourced ? (
                            <Badge variant="secondary" className="text-xs bg-amber-50 text-amber-700 border-amber-300">
                              {item.availableWarehouses[0]?.warehouseName || "Outsourced"}
                            </Badge>
                          ) : item.availableWarehouses.length === 0 ? (
                            <Badge variant="destructive" className="text-xs">No stock available</Badge>
                          ) : (
                            item.availableWarehouses.map(wh => (
                              <Badge key={wh.warehouseId} variant="secondary" className="text-xs">
                                {wh.warehouseName}: {wh.availableQuantity} available
                              </Badge>
                            ))
                          )}
                        </div>
                      </CardHeader>
                      <CardContent className="space-y-3">
                        {item.isOutsourced ? (
                          // For outsourced items, show supplier info (non-editable)
                          <>
                            {item.allocations.map((alloc, allocIndex) => (
                              <div key={allocIndex} className="flex items-center gap-3 p-3 bg-amber-50 rounded border border-amber-200">
                                <div className="flex-1">
                                  <p className="text-sm font-medium text-amber-900">Supplier: {alloc.warehouseName}</p>
                                  <p className="text-xs text-amber-700">Item will be sourced from this supplier</p>
                                </div>
                                <div className="flex items-center gap-1">
                                  <Input
                                    type="number"
                                    min="0"
                                    max={item.totalQuantity}
                                    value={alloc.quantity}
                                    onChange={(e) => {
                                      const qty = Math.min(parseInt(e.target.value) || 0, item.totalQuantity)
                                      setItemAllocations(prev => prev.map((it, i) => 
                                        i === itemIndex ? {
                                          ...it,
                                          allocations: it.allocations.map((a, ai) =>
                                            ai === allocIndex ? { ...a, quantity: qty } : a
                                          )
                                        } : it
                                      ))
                                    }}
                                    className="w-20"
                                    placeholder="Qty"
                                  />
                                  <span className="text-xs text-muted-foreground">/ {item.totalQuantity}</span>
                                </div>
                                <span className="text-sm text-muted-foreground w-12">{item.unit}</span>
                              </div>
                            ))}
                            {(() => {
                              const totalAllocated = item.allocations.reduce((sum, a) => sum + a.quantity, 0)
                              const remaining = item.totalQuantity - totalAllocated
                              return remaining !== 0 ? (
                                <p className={`text-xs ${remaining > 0 ? 'text-amber-700' : 'text-red-700'}`}>
                                  {remaining > 0 
                                    ? `${remaining} units not yet allocated`
                                    : `Over-allocated by ${Math.abs(remaining)} units`
                                  }
                                </p>
                              ) : (
                                <p className="text-xs text-green-700">All {totalAllocated} units allocated</p>
                              )
                            })()}
                          </>
                        ) : item.availableWarehouses.length === 0 ? (
                          <p className="text-sm text-red-700">This product is not available in any warehouse. Please check inventory.</p>
                        ) : (
                          <>
                            {item.allocations.map((alloc, allocIndex) => {
                              const warehouseStock = item.availableWarehouses.find(w => w.warehouseId === alloc.warehouseId)
                              const maxQty = warehouseStock?.availableQuantity || 0
                              
                              return (
                                <div key={allocIndex} className="flex items-center gap-3">
                                  <Select
                                    value={alloc.warehouseId}
                                    onValueChange={(value) => {
                                      const wh = item.availableWarehouses.find(w => w.warehouseId === value)
                                      setItemAllocations(prev => prev.map((it, i) => 
                                        i === itemIndex ? {
                                          ...it,
                                          allocations: it.allocations.map((a, ai) =>
                                            ai === allocIndex ? { 
                                              ...a, 
                                              warehouseId: value, 
                                              warehouseName: wh?.warehouseName || '',
                                              quantity: Math.min(a.quantity, wh?.availableQuantity || 0)
                                            } : a
                                          )
                                        } : it
                                      ))
                                    }}
                                  >
                                    <SelectTrigger className="flex-1">
                                      <SelectValue placeholder="Select warehouse" />
                                    </SelectTrigger>
                                    <SelectContent>
                                      {item.availableWarehouses.map((wh) => (
                                        <SelectItem key={wh.warehouseId} value={wh.warehouseId}>
                                          {wh.warehouseName} ({wh.availableQuantity} available)
                                        </SelectItem>
                                      ))}
                                    </SelectContent>
                                  </Select>
                                  <div className="flex items-center gap-1">
                                    <Input
                                      type="number"
                                      min="0"
                                      max={maxQty}
                                      value={alloc.quantity}
                                      onChange={(e) => {
                                        const qty = Math.min(parseInt(e.target.value) || 0, maxQty)
                                        setItemAllocations(prev => prev.map((it, i) => 
                                          i === itemIndex ? {
                                            ...it,
                                            allocations: it.allocations.map((a, ai) =>
                                              ai === allocIndex ? { ...a, quantity: qty } : a
                                            )
                                          } : it
                                        ))
                                      }}
                                      className="w-20"
                                      placeholder="Qty"
                                    />
                                    <span className="text-xs text-muted-foreground">/ {maxQty}</span>
                                  </div>
                                  <span className="text-sm text-muted-foreground w-12">{item.unit}</span>
                                  {item.allocations.length > 1 && (
                                    <Button
                                      type="button"
                                      variant="ghost"
                                      size="sm"
                                      aria-label={t("action.remove")}
                                      onClick={() => {
                                        setItemAllocations(prev => prev.map((it, i) => 
                                          i === itemIndex ? {
                                            ...it,
                                            allocations: it.allocations.filter((_, ai) => ai !== allocIndex)
                                          } : it
                                        ))
                                      }}
                                      className="h-8 w-8 p-0 text-red-700 hover:text-red-700"
                                    >
                                      <X className="w-4 h-4" />
                                    </Button>
                                  )}
                                </div>
                              )
                            })}
                            
                            <div className="flex items-center justify-between flex-wrap gap-2">
                              {availableForSplit.length > 0 ? (
                                <Button
                                  type="button"
                                  variant="outline"
                                  size="sm"
                                  onClick={() => {
                                    const nextWh = availableForSplit[0]
                                    if (nextWh) {
                                      setItemAllocations(prev => prev.map((it, i) => 
                                        i === itemIndex ? {
                                          ...it,
                                          allocations: [
                                            ...it.allocations,
                                            { warehouseId: nextWh.warehouseId, warehouseName: nextWh.warehouseName, quantity: 0 }
                                          ]
                                        } : it
                                      ))
                                    }
                                  }}
                                  className="h-7 text-xs"
                                >
                                  <Plus className="w-3 h-3 me-1" />
                                  Split to Another Warehouse ({availableForSplit.length} available)
                                </Button>
                              ) : (
                                <span className="text-xs text-muted-foreground">No other warehouses have this product</span>
                              )}
                              
                              {(() => {
                                const totalAllocated = item.allocations.reduce((sum, a) => sum + a.quantity, 0)
                                const remaining = item.totalQuantity - totalAllocated
                                return remaining !== 0 ? (
                                  <p className={`text-xs ${remaining > 0 ? 'text-amber-700' : 'text-red-700'}`}>
                                    {remaining > 0 
                                      ? `${remaining} units not yet allocated`
                                      : `Over-allocated by ${Math.abs(remaining)} units`
                                    }
                                  </p>
                                ) : (
                                  <p className="text-xs text-green-700">All {totalAllocated} units allocated</p>
                                )
                              })()}
                            </div>
                          </>
                        )}
                      </CardContent>
                    </Card>
                  )
                })}
              </div>

              <div className="space-y-2">
                <Label>Notes (optional)</Label>
                <Textarea
                  placeholder="Any special instructions for the shipping team..."
                  value={allocationNotes}
                  onChange={(e) => setAllocationNotes(e.target.value)}
                  rows={2}
                />
              </div>

              <div className="flex flex-wrap justify-end gap-2 pt-4 border-t">
                <Button variant="outline" onClick={() => setShowAllocationDialog(false)}>
                  Cancel
                </Button>
                <Button 
                  onClick={handleSaveAllocations}
                  disabled={savingAllocation}
                  className="bg-green-600 hover:bg-green-700"
                >
                  <CheckCircle className="w-4 h-4 me-2" />
                  {savingAllocation ? "Saving..." : "Save & Mark Ready for Shipment"}
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
      
      {/* Return Processing Dialog */}
      <Dialog open={showReturnProcessDialog} onOpenChange={setShowReturnProcessDialog}>
        <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <RotateCcw className="w-5 h-5 text-orange-700" />
              Process Return - Assign Warehouses
            </DialogTitle>
          </DialogHeader>
          
          {selectedReturn && (
            <div className="space-y-4">
              <div className="bg-muted/30 p-4 rounded-lg">
                <p className="font-medium">SO: {selectedReturn.soNumber}</p>
                <p className="text-sm text-muted-foreground">Customer: {selectedReturn.customerName}</p>
              </div>
              
              <div className="space-y-4">
                <p className="text-sm font-medium">Select warehouse for each returned item:</p>
                {selectedReturn.items?.map((item: any, idx: number) => (
                  <Card key={idx} className={item.condition === "good" ? "border-green-200" : "border-red-200"}>
                    <CardContent className="pt-4">
                      <div className="flex items-start justify-between mb-3 flex-wrap gap-2">
                        <div className="min-w-0 break-words">
                          <p className="font-semibold">{item.productName}</p>
                          <p className="text-sm text-muted-foreground">Quantity: {item.quantityReturned}</p>
                          <div className="flex gap-2 mt-1 flex-wrap">
                            <Badge variant="secondary">{item.reason}</Badge>
                            <Badge variant={item.condition === "good" ? "outline" : "destructive"}>
                              {item.condition === "good" ? "Can be restocked" : item.condition}
                            </Badge>
                            {item.isOutsourced && (
                              <Badge variant="outline" className="bg-purple-50 text-purple-700 border-purple-300">
                                Outsourced
                              </Badge>
                            )}
                          </div>
                        </div>
                      </div>
                      
                      {item.condition === "good" ? (
                        <div>
                          <Label>Assign to Warehouse *</Label>
                          <Select
                            value={returnWarehouseSelections[`${idx}`] || ""}
                            onValueChange={(value) => setReturnWarehouseSelections(prev => ({
                              ...prev,
                              [`${idx}`]: value
                            }))}
                          >
                            <SelectTrigger>
                              <SelectValue placeholder="Select warehouse" />
                            </SelectTrigger>
                            <SelectContent>
                              {warehouses.map((wh) => (
                                <SelectItem key={wh.id} value={String(wh.id)}>
                                  {wh.name}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                      ) : (
                        <p className="text-sm text-amber-700 bg-amber-50 p-2 rounded">
                          This item is marked as {item.condition} and will not be restocked automatically.
                          Manual inspection required.
                        </p>
                      )}
                    </CardContent>
                  </Card>
                ))}
              </div>
              
              <div className="flex flex-wrap justify-end gap-2 pt-4 border-t">
                <Button variant="outline" onClick={() => setShowReturnProcessDialog(false)} className="bg-transparent">
                  Cancel
                </Button>
                <Button
                  onClick={async () => {
                    // Validate all "good" condition items have a warehouse selected
                    const goodItems = (selectedReturn.items || []).filter((item: any) => item.condition === "good")
                    const missing = goodItems.filter((_: any, idx: number) => !returnWarehouseSelections[`${idx}`])
                    if (missing.length > 0) {
                      alert(`Please select a warehouse for all good-condition items before processing.`)
                      return
                    }

                    // Build the assignments array from the selections state
                    const builtAssignments = (selectedReturn.items || []).map((item: any, idx: number) => ({
                      returnItemId: item.id,
                      productId: item.productId || null,
                      productName: item.productName,
                      isOutsourced: item.isOutsourced || !item.productId,
                      warehouseId: returnWarehouseSelections[`${idx}`] || null,
                      condition: item.condition || "good",
                      quantityReturned: item.quantityReturned || 0,
                      reason: item.reason || "other",
                      supplierName: item.supplierName || null,
                      unitCost: item.unitCost || null,
                    }))

                    setProcessingReturn(true)
                    try {
                      const response = await fetch("/api/returns", {
                        method: "PUT",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({
                          returnId: selectedReturn.id,
                          status: "completed",
                          processedBy: user?.name || "warehouse_manager",
                          warehouseAssignments: builtAssignments,
                        }),
                      })
                      
                      if (response.ok) {
                        alert("Return processed successfully! Inventory has been updated.")
                        setShowReturnProcessDialog(false)
                        setSelectedReturn(null)
                        setReturnWarehouseSelections({})
                        fetchPendingReturns()
                        await refreshInventory()
                      } else {
                        const error = await response.json()
                        alert(`Failed to process return: ${error.error || "Unknown error"}`)
                      }
                    } catch (error) {
                      alert("Failed to process return")
                    } finally {
                      setProcessingReturn(false)
                    }
                  }}
                  disabled={processingReturn}
                  className="bg-green-600 hover:bg-green-700"
                >
                  <CheckCircle className="w-4 h-4 me-2" />
                  {processingReturn ? "Processing..." : "Process Return & Update Inventory"}
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}
