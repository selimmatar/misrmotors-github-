"use client"

import { useState, useEffect, useRef } from "react"
import { useAppContext } from "@/lib/app-context"
import { useI18n } from "@/lib/i18n-context"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Truck, Upload, CheckCircle, Eye, Package, User, Printer, RotateCcw, Minus, Plus, Wrench } from "lucide-react"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog"
import { Textarea } from "@/components/ui/textarea"
import { PermitPreviewDialog } from "@/components/delivery-permit/permit-preview-dialog"
import { PageHeader } from "@/components/erp/page-header"
import { StatusBadge } from "@/components/erp/status-badge"
import { formatDate } from "@/lib/format"
import type { DeliveryPermit } from "@/lib/types"
import { ShippingMaintenanceTab } from "@/components/shipping/maintenance-tab"

interface ReturnItem {
  /** id of the delivery permit line this return line refers to */
  permitItemId?: string
  productId: string
  productName: string
  sku: string
  maxQuantity: number
  quantityReturned: number
  reason: string
  condition: string
  isOutsourced: boolean
  itemType?: string
  supplierName?: string | null
  unitCost?: number | null
}

export function ShippingModule() {
  const { salesOrders, customers, user, couriers, refreshCouriers, products } = useAppContext()
  const { t, formatNumber, language } = useI18n()
  const [permits, setPermits] = useState<DeliveryPermit[]>([])
  const [loading, setLoading] = useState(true)
  const [uploadingFor, setUploadingFor] = useState<string | null>(null)
  const [signedFile, setSignedFile] = useState<File | null>(null)
  const [uploading, setUploading] = useState(false)
  const [selectedCouriers, setSelectedCouriers] = useState<Record<string, string>>({})
  const [assigningDriver, setAssigningDriver] = useState<string | null>(null)
  const [previewPermit, setPreviewPermit] = useState<DeliveryPermit | null>(null)
  const [showPreviewDialog, setShowPreviewDialog] = useState(false)
  
  // Operations employees
  const [operationsEmployees, setOperationsEmployees] = useState<any[]>([])

  // Return states
  const [showReturnDialog, setShowReturnDialog] = useState(false)
  const [selectedPermitForReturn, setSelectedPermitForReturn] = useState<DeliveryPermit | null>(null)
  const [returnItems, setReturnItems] = useState<ReturnItem[]>([])
  const [returnNotes, setReturnNotes] = useState("")
  const [returnCourierName, setReturnCourierName] = useState("")
  const [submittingReturn, setSubmittingReturn] = useState(false)
  const [pendingReturns, setPendingReturns] = useState<any[]>([])
  // One idempotency key per opened return dialog: a double click or retry of the same submit can never create two returns.
  const returnIdempotencyKey = useRef<string>("")
  const returnSubmitInFlight = useRef(false)

  const fetchPermits = async () => {
    setLoading(true)
    try {
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

  const fetchOperationsEmployees = async () => {
    try {
      const response = await fetch("/api/hr/employees")
      if (response.ok) {
        const data = await response.json()
        const ops = data.filter((emp: any) =>
          emp.position?.position_title?.toLowerCase().includes("operations") ||
          emp.position?.position_code?.toLowerCase().includes("operations")
        )
        setOperationsEmployees(ops)
      }
    } catch (error) {
      console.error("Error fetching operations employees:", error)
    }
  }

  useEffect(() => {
    fetchPermits()
    fetchPendingReturns()
    fetchOperationsEmployees()
  }, [])

  const readyForPickup = permits.filter((p) => p.status === "READY_FOR_PICKUP" || p.status === "PRINTED")
  const outForDelivery = permits.filter((p) => p.status === "OUT_FOR_DELIVERY")
  const delivered = permits.filter((p) => p.status === "SUBMITTED_SIGNED" || p.status === "APPROVED")

  const getCustomerName = (customerId?: string) => {
    if (!customerId) return t("customer.unknown")
    const customer = customers.find((c) => c.id === customerId)
    return customer?.name || t("customer.unknown")
  }

  const handleMarkOutForDelivery = async (permit: DeliveryPermit) => {
    const employeeId = selectedCouriers[permit.id]
    if (!employeeId) {
      alert(t("shipping.select-courier"))
      return
    }

    const selectedEmployee = operationsEmployees.find((e) => String(e.employee_id) === employeeId)
    if (!selectedEmployee) {
      alert(t("shipping.select-courier"))
      return
    }

    try {
      const response = await fetch("/api/delivery-permits", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          permitId: permit.id,
          action: "MARK_OUT_FOR_DELIVERY",
          userId: user?.id,
          courierId: employeeId,
          driverName: selectedEmployee.full_name,
        }),
      })

      if (response.ok) {
        setSelectedCouriers((prev) => ({ ...prev, [permit.id]: "" }))
        setAssigningDriver(null)
        fetchPermits()
      } else {
        const error = await response.json()
        alert(error.error || t("message.error"))
      }
    } catch (error) {
      console.error("Error marking out for delivery:", error)
      alert(t("message.error"))
    }
  }

  const handleUploadSigned = async (permit: DeliveryPermit) => {
    if (!signedFile) {
      alert(t("shipping.select-file"))
      return
    }

    setUploading(true)
    try {
      const formData = new FormData()
      formData.append("file", signedFile)
      formData.append("permitId", permit.id)
      formData.append("fileType", "SIGNED_PERMIT")

      const uploadResponse = await fetch("/api/delivery-permits/upload", {
        method: "POST",
        body: formData,
      })

      if (!uploadResponse.ok) {
        throw new Error("Upload failed")
      }

      const response = await fetch("/api/delivery-permits", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          permitId: permit.id,
          action: "MARK_SUBMITTED_SIGNED",
          userId: user?.id,
        }),
      })

      if (response.ok) {
        setSignedFile(null)
        setUploadingFor(null)
        fetchPermits()
        alert(t("message.success"))
      } else {
        const error = await response.json()
        alert(error.error || t("message.error"))
      }
    } catch (error) {
      console.error("Error uploading signed permit:", error)
      alert(t("message.error"))
    } finally {
      setUploading(false)
    }
  }

  // Label for the permit status badge; other values use the default StatusBadge label.
  const getPermitLabel = (status: string): string | undefined => {
    switch (status) {
      case "READY_FOR_PICKUP":
        return t("permit.status.ready-for-pickup")
      case "PRINTED":
        return t("permit.status.printed")
      case "OUT_FOR_DELIVERY":
        return t("permit.status.out-for-delivery")
      case "SUBMITTED_SIGNED":
        return t("permit.status.submitted-signed")
      case "APPROVED":
        return t("permit.status.approved")
      default:
        return undefined
    }
  }

  const getCourierName = (courierId?: string) => {
    if (!courierId) return null
    // First check operations employees
    const emp = operationsEmployees.find((e) => String(e.employee_id) === courierId)
    if (emp) return emp.full_name
    // Fallback to couriers for legacy data
    const courier = couriers.find((c) => c.id === courierId)
    return courier?.name
  }
  
  const openReturnDialog = (permit: DeliveryPermit) => {
    setSelectedPermitForReturn(permit)
    // Initialize return items from permit items
    const items: ReturnItem[] = (permit.items || []).map((item: any) => {
      // Check if item is outsourced - either by itemType or if productId is missing/null
      const isOutsourced = item.itemType === "outsourced" || !item.productId || item.productId === ""
      return {
        permitItemId: item.id,
        productId: item.productId || "",
        productName: item.itemNameSnapshot || item.productName || item.outsourcedName || "Unknown Item",
        sku: item.sku || "",
        // what is still returnable: delivered quantity minus what earlier (non-rejected) returns already took
        maxQuantity: Math.max((Number(item.quantity) || 0) - (Number(item.returnedQuantity) || 0), 0),
        quantityReturned: 0,
        reason: "",
        condition: "good",
        isOutsourced,
        itemType: item.itemType || (isOutsourced ? "outsourced" : "stock"),
        supplierName: item.supplierName || null,
        unitCost: item.unitCost ? Number(item.unitCost) : null,
      }
    })
    setReturnItems(items)
    setReturnNotes("")
    returnIdempotencyKey.current = `ret-${crypto.randomUUID()}`
    setShowReturnDialog(true)
  }
  
  const updateReturnItemQuantity = (index: number, delta: number) => {
    setReturnItems((prev) => {
      const updated = [...prev]
      const newQty = Math.max(0, Math.min(updated[index].maxQuantity, updated[index].quantityReturned + delta))
      updated[index].quantityReturned = newQty
      return updated
    })
  }
  
  const updateReturnItemReason = (index: number, reason: string) => {
    setReturnItems((prev) => {
      const updated = [...prev]
      updated[index].reason = reason
      return updated
    })
  }
  
  const updateReturnItemCondition = (index: number, condition: string) => {
    setReturnItems((prev) => {
      const updated = [...prev]
      updated[index].condition = condition
      return updated
    })
  }
  
  const handleSubmitReturn = async () => {
    if (!selectedPermitForReturn || returnSubmitInFlight.current) return
    
    const itemsToReturn = returnItems.filter((item) => item.quantityReturned > 0)
    if (itemsToReturn.length === 0) {
      alert("Please select at least one item to return")
      return
    }
    
    // Check all items have reasons
    const missingReasons = itemsToReturn.some((item) => !item.reason)
    if (missingReasons) {
      alert("Please provide a reason for each item being returned")
      return
    }
    
    returnSubmitInFlight.current = true
    setSubmittingReturn(true)
    try {
      const response = await fetch("/api/returns", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // The server derives the sales order, customer and item details from the delivery permit itself.
        body: JSON.stringify({
          permitId: Number(selectedPermitForReturn.id),
          idempotencyKey: returnIdempotencyKey.current,
          createdBy: user?.name || "shipping_team",
          courierName: returnCourierName,
          notes: returnNotes,
          items: itemsToReturn.map((item) => ({
            permitItemId: item.permitItemId,
            productId: item.productId,
            productName: item.productName,
            sku: item.sku,
            maxQuantity: item.maxQuantity,
            quantityReturned: item.quantityReturned,
            reason: item.reason,
            condition: item.condition,
            isOutsourced: item.isOutsourced,
            itemType: item.itemType,
            supplierName: item.supplierName || null,
            unitCost: item.unitCost || null,
          })),
        }),
      })
      
      if (response.ok) {
        alert("Return request submitted successfully! Warehouse will process the return.")
        setShowReturnDialog(false)
        setSelectedPermitForReturn(null)
        setReturnCourierName("")
        setReturnNotes("")
        fetchPendingReturns()
      } else {
        const error = await response.json()
        alert(`Failed to submit return: ${error.error || "Unknown error"}`)
      }
    } catch (error) {
      alert("Failed to submit return request")
    } finally {
      returnSubmitInFlight.current = false
      setSubmittingReturn(false)
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader group={t("group.operations")} title={t("shipping.title")} subtitle={t("shipping.description")} />

      <Tabs defaultValue="ready" className="space-y-4">
        <TabsList className="grid w-full grid-cols-5">
          <TabsTrigger value="ready">
            {t("shipping.ready-for-pickup")} ({formatNumber(readyForPickup.length)})
          </TabsTrigger>
          <TabsTrigger value="out">
            {t("permit.status.out-for-delivery")} ({formatNumber(outForDelivery.length)})
          </TabsTrigger>
          <TabsTrigger value="delivered">
            {t("shipping.delivered")} ({formatNumber(delivered.length)})
          </TabsTrigger>
          <TabsTrigger value="returns">
            {t("returns.title")} ({formatNumber(pendingReturns.length)})
          </TabsTrigger>
          <TabsTrigger value="maintenance">
            <Wrench className="w-4 h-4 me-2" />
            Maintenance
          </TabsTrigger>
        </TabsList>

        {/* Ready for Pickup Tab */}
        <TabsContent value="ready" className="space-y-4">
          {loading ? (
            <Card>
              <CardContent className="py-8 text-center">{t("loading")}...</CardContent>
            </Card>
          ) : readyForPickup.length === 0 ? (
            <Card>
              <CardContent className="flex flex-col items-center justify-center py-12">
                <Package className="w-12 h-12 text-muted-foreground mb-4" />
                <p className="text-muted-foreground">{t("shipping.no-ready-permits")}</p>
              </CardContent>
            </Card>
          ) : (
            <div className="grid gap-4">
              {readyForPickup.map((permit) => (
                <Card key={permit.id}>
                  <CardHeader>
                    <div className="flex items-start justify-between">
                      <div>
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
                    <div className="space-y-4">
                      <div className="grid grid-cols-3 gap-4 text-sm">
                        <div>
                          <p className="text-muted-foreground">{t("permit.recipient")}</p>
                          <p className="font-medium">{permit.recipientName || permit.customerName || "-"}</p>
                        </div>
                        <div>
                          <p className="text-muted-foreground">{t("field.phone")}</p>
                          <p className="font-medium">{permit.recipientPhone || permit.customerPhone || "-"}</p>
                        </div>
                        <div>
                          <p className="text-muted-foreground">{t("permit.delivery-address")}</p>
                          <p className="font-medium">{permit.deliveryAddress || permit.customerAddress || "-"}</p>
                        </div>
                      </div>

                      {permit.items && permit.items.length > 0 && (
                        <div>
                          <p className="text-sm text-muted-foreground mb-2">{t("field.items")}:</p>
                          <div className="space-y-1">
                            {permit.items.map((item, idx) => (
                              <div key={idx} className="flex justify-between text-sm">
                                <span>
                                  {item.itemNameSnapshot} × {formatNumber(item.quantity)}
                                </span>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}

                      {assigningDriver === permit.id ? (
                        <div className="space-y-3 border-t pt-4">
                          <div>
                            <Label className="flex items-center gap-2">
                              <User className="w-4 h-4" />
                              {language === "ar" ? "اختر موظف العمليات" : "Select Operations Employee"}
                            </Label>
                            <Select
                              value={selectedCouriers[permit.id] || ""}
                              onValueChange={(value) =>
                                setSelectedCouriers((prev) => ({ ...prev, [permit.id]: value }))
                              }
                            >
                              <SelectTrigger className="mt-1">
                                <SelectValue placeholder={language === "ar" ? "اختر موظف..." : "Select employee..."} />
                              </SelectTrigger>
                              <SelectContent>
                                {operationsEmployees.length === 0 ? (
                                  <SelectItem value="none" disabled>
                                    {language === "ar" ? "لا يوجد موظفين عمليات" : "No operations employees"}
                                  </SelectItem>
                                ) : (
                                  operationsEmployees.map((emp) => (
                                    <SelectItem key={emp.employee_id} value={String(emp.employee_id)}>
                                      <div className="flex items-center gap-2">
                                        <span>{emp.full_name}</span>
                                        {emp.position?.position_title && (
                                          <span className="text-muted-foreground text-xs">
                                            ({emp.position.position_title})
                                          </span>
                                        )}
                                      </div>
                                    </SelectItem>
                                  ))
                                )}
                              </SelectContent>
                            </Select>
                          </div>
                          <div className="flex gap-2">
                            <Button
                              variant="outline"
                              onClick={() => {
                                const printUrl = `${window.location.origin}/api/delivery-permits/pdf?permitId=${permit.id}`
                                window.open(printUrl, "_blank")
                              }}
                              className="flex-1"
                            >
                              <Printer className="w-4 h-4 me-2" />
                              {t("action.print-dp")}
                            </Button>
                          </div>
                          <div className="flex gap-2">
                            <Button
                              onClick={() => handleMarkOutForDelivery(permit)}
                              disabled={!selectedCouriers[permit.id]}
                              className="flex-1"
                            >
                              <Truck className="w-4 h-4 me-2" />
                              {t("shipping.confirm-dispatch")}
                            </Button>
                            <Button
                              variant="outline"
                              onClick={() => {
                                setAssigningDriver(null)
                                setSelectedCouriers((prev) => ({ ...prev, [permit.id]: "" }))
                              }}
                            >
                              {t("action.cancel")}
                            </Button>
                          </div>
                        </div>
                      ) : (
                        <Button onClick={() => setAssigningDriver(permit.id)} className="w-full">
                          <Truck className="w-4 h-4 me-2" />
                          {t("shipping.mark-out-for-delivery")}
                        </Button>
                      )}
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </TabsContent>

        {/* Out for Delivery Tab */}
        <TabsContent value="out" className="space-y-4">
          {loading ? (
            <Card>
              <CardContent className="py-8 text-center">{t("loading")}...</CardContent>
            </Card>
          ) : outForDelivery.length === 0 ? (
            <Card>
              <CardContent className="flex flex-col items-center justify-center py-12">
                <Truck className="w-12 h-12 text-muted-foreground mb-4" />
                <p className="text-muted-foreground">{t("shipping.no-out-for-delivery")}</p>
              </CardContent>
            </Card>
          ) : (
            <div className="grid gap-4">
              {outForDelivery.map((permit) => (
                <Card key={permit.id} className="border-amber-200 bg-amber-50/30">
                  <CardHeader>
                    <div className="flex items-start justify-between">
                      <div>
                        <CardTitle className="flex items-center gap-2">
                          {permit.permitNo}
                          <StatusBadge status={permit.status} label={getPermitLabel(permit.status)} />
                        </CardTitle>
                        <p className="text-sm text-muted-foreground mt-1">
                          {t("field.so-number")}: {permit.soNumber} | {t("field.customer")}: {permit.customerName}
                        </p>
                        {(permit.courierId || permit.driverName) && (
                          <p className="text-sm mt-1 flex items-center gap-1">
                            <User className="w-3 h-3" />
                            <span className="font-medium">
                              {t("shipping.courier")}: {getCourierName(permit.courierId) || permit.driverName}
                            </span>
                          </p>
                        )}
                      </div>
                      <div className="text-end">
                        <p className="text-sm text-muted-foreground">
                          {t("shipping.out-since")}: {formatDate(permit.outForDeliveryAt, language)}
                        </p>
                      </div>
                    </div>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-4">
                    <div className="grid grid-cols-3 gap-4 text-sm">
                      <div>
                        <p className="text-muted-foreground">{t("permit.recipient")}</p>
                        <p className="font-medium">{permit.recipientName || permit.customerName || "-"}</p>
                      </div>
                      <div>
                        <p className="text-muted-foreground">{t("field.phone")}</p>
                        <p className="font-medium">{permit.recipientPhone || permit.customerPhone || "-"}</p>
                      </div>
                      <div>
                        <p className="text-muted-foreground">{t("permit.delivery-address")}</p>
                        <p className="font-medium">{permit.deliveryAddress || permit.customerAddress || "-"}</p>
                      </div>
                    </div>

                      {/* The customer may refuse an item when the driver arrives, so returns are allowed here too. */}
                      <div className="flex gap-2 mb-4">
                        <Button variant="outline" size="sm" onClick={() => openReturnDialog(permit)} className="bg-transparent">
                          <RotateCcw className="w-4 h-4 me-2" />
                          Return Items
                        </Button>
                      </div>

                      {uploadingFor === permit.id ? (
                        <div className="space-y-3 border-t pt-4">
                          <div>
                            <Label htmlFor={`signed-${permit.id}`}>{t("shipping.upload-signed-permit")}</Label>
                            <Input
                              id={`signed-${permit.id}`}
                              type="file"
                              accept="image/*,.pdf"
                              onChange={(e) => setSignedFile(e.target.files?.[0] || null)}
                              className="mt-1"
                            />
                          </div>
                          <div className="flex gap-2">
                            <Button
                              onClick={() => handleUploadSigned(permit)}
                              disabled={!signedFile || uploading}
                              className="flex-1"
                            >
                              <CheckCircle className="w-4 h-4 me-2" />
                              {uploading ? t("loading") : t("shipping.confirm-delivery")}
                            </Button>
                            <Button
                              variant="outline"
                              onClick={() => {
                                setUploadingFor(null)
                                setSignedFile(null)
                              }}
                            >
                              {t("action.cancel")}
                            </Button>
                          </div>
                        </div>
                      ) : (
                        <Button
                          onClick={() => setUploadingFor(permit.id)}
                          className="w-full bg-green-600 hover:bg-green-700"
                        >
                          <Upload className="w-4 h-4 me-2" />
                          {t("shipping.upload-signed-permit")}
                        </Button>
                      )}
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </TabsContent>

        {/* Delivered Tab */}
        <TabsContent value="delivered" className="space-y-4">
          {loading ? (
            <Card>
              <CardContent className="py-8 text-center">{t("loading")}...</CardContent>
            </Card>
          ) : delivered.length === 0 ? (
            <Card>
              <CardContent className="flex flex-col items-center justify-center py-12">
                <CheckCircle className="w-12 h-12 text-muted-foreground mb-4" />
                <p className="text-muted-foreground">{t("shipping.no-delivered")}</p>
              </CardContent>
            </Card>
          ) : (
            <div className="grid gap-4">
              {delivered.map((permit) => (
                <Card key={permit.id} className="border-green-200 bg-green-50/30">
                  <CardHeader>
                    <div className="flex items-start justify-between">
                      <div>
                        <CardTitle className="flex items-center gap-2">
                          {permit.permitNo}
                          <StatusBadge status={permit.status} label={getPermitLabel(permit.status)} />
                        </CardTitle>
                        <p className="text-sm text-muted-foreground mt-1">
                          {t("field.so-number")}: {permit.soNumber} | {t("field.customer")}: {permit.customerName}
                        </p>
                        {(permit.courierId || permit.driverName) && (
                          <p className="text-sm mt-1 flex items-center gap-1">
                            <User className="w-3 h-3" />
                            <span className="font-medium">
                              {t("shipping.courier")}: {getCourierName(permit.courierId) || permit.driverName}
                            </span>
                          </p>
                        )}
                      </div>
                      <div className="text-end">
                        <p className="text-sm text-muted-foreground">
                          {t("shipping.delivered-on")}: {formatDate(permit.submittedSignedAt, language)}
                        </p>
                      </div>
                    </div>
                  </CardHeader>
                  <CardContent className="flex flex-wrap gap-2">
                    {permit.files && permit.files.length > 0 && (
                      <Button
                        size="sm"
                        variant="outline"
                        className="gap-2 bg-transparent"
                        onClick={() => {
                          setPreviewPermit(permit)
                          setShowPreviewDialog(true)
                        }}
                      >
                        <Eye className="w-4 h-4" />
                        {t("shipping.view-signed-permit")}
                      </Button>
                    )}
                    {/* Returns are accepted for permits that are out for delivery or delivered. */}
                    <Button size="sm" variant="outline" className="gap-2 bg-transparent" onClick={() => openReturnDialog(permit)}>
                      <RotateCcw className="w-4 h-4" />
                      Return Items
                    </Button>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </TabsContent>

        {/* Returns Tab */}
        <TabsContent value="returns" className="space-y-4">
          {pendingReturns.length === 0 ? (
            <Card>
              <CardContent className="flex flex-col items-center justify-center py-12">
                <RotateCcw className="w-12 h-12 text-muted-foreground mb-4" />
                <p className="text-muted-foreground">No pending returns</p>
                <p className="text-sm text-muted-foreground mt-1">Returns submitted will appear here until processed by warehouse</p>
              </CardContent>
            </Card>
          ) : (
            <div className="grid gap-4">
              {pendingReturns.map((returnReq) => (
                <Card key={returnReq.id} className="border-orange-200 bg-orange-50/30">
                  <CardHeader>
                    <div className="flex items-start justify-between">
                      <div>
                        <CardTitle className="flex items-center gap-2">
                          Return #{returnReq.id}
                          <Badge variant="outline" className="bg-orange-100 text-orange-700 border-orange-300">
                            Pending Warehouse
                          </Badge>
                        </CardTitle>
                        <p className="text-sm text-muted-foreground mt-1">
                          SO: {returnReq.soNumber} | Customer: {returnReq.customerName}
                        </p>
                      </div>
                      <div className="text-end text-sm text-muted-foreground">
                        {formatDate(returnReq.returnDate, language)}
                      </div>
                    </div>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-2">
                      <p className="text-sm font-medium">Items to return:</p>
                      
                      {returnReq.items?.map((item: any, idx: number) => (
                        <div key={idx} className="flex justify-between items-center text-sm bg-white rounded p-2">
                          <span>{item.productName} (x{item.quantityReturned})</span>
                          <Badge variant="secondary">{item.reason}</Badge>
                        </div>
                      ))}
                      {returnReq.notes && (
                        <p className="text-sm text-muted-foreground mt-2">Notes: {returnReq.notes}</p>
                      )}
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </TabsContent>

        {/* Maintenance Tab */}
        <TabsContent value="maintenance" className="space-y-4">
          <ShippingMaintenanceTab userRole={user?.role || "shipping"} />
        </TabsContent>
      </Tabs>

      {/* Return Dialog */}
      <Dialog open={showReturnDialog} onOpenChange={setShowReturnDialog}>
        <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Return Items from Delivery</DialogTitle>
            <DialogDescription>
              {selectedPermitForReturn && (
                <>SO: {selectedPermitForReturn.soNumber} | Customer: {selectedPermitForReturn.customerName}</>
              )}
            </DialogDescription>
          </DialogHeader>
          
          <div className="space-y-4">
            {returnItems.map((item, index) => (
              <Card key={index} className={item.quantityReturned > 0 ? "border-orange-300 bg-orange-50" : ""}>
                <CardContent className="pt-4">
                  <div className="flex items-start justify-between">
                    <div>
                      <div className="flex items-center gap-2">
                        <p className="font-semibold">{item.productName || "Unknown Item"}</p>
                        {item.isOutsourced && (
                          <Badge variant="outline" className="bg-purple-50 text-purple-700 border-purple-300">
                            Outsourced
                          </Badge>
                        )}
                      </div>
                      <p className="text-sm text-muted-foreground">SKU: {item.sku || "N/A"}</p>
                      <p className="text-sm">Max available: {item.maxQuantity}</p>
                    </div>
                    <div className="flex items-center gap-2">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => updateReturnItemQuantity(index, -1)}
                        disabled={item.quantityReturned <= 0}
                        className="bg-transparent"
                      >
                        -
                      </Button>
                      <span className="w-12 text-center font-semibold text-lg">{item.quantityReturned}</span>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => updateReturnItemQuantity(index, 1)}
                        disabled={item.quantityReturned >= item.maxQuantity}
                        className="bg-transparent"
                      >
                        +
                      </Button>
                    </div>
                  </div>
                  
                  {item.quantityReturned > 0 && (
                    <div className="mt-4 space-y-3">
                      <div>
                        <Label>Reason for Return *</Label>
                        <Select value={item.reason} onValueChange={(value) => updateReturnItemReason(index, value)}>
                          <SelectTrigger>
                            <SelectValue placeholder="Select reason" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="damaged">Damaged</SelectItem>
                            <SelectItem value="wrong_item">Wrong Item</SelectItem>
                            <SelectItem value="customer_refused">Customer Refused</SelectItem>
                            <SelectItem value="excess_quantity">Excess Quantity</SelectItem>
                            <SelectItem value="defective">Defective</SelectItem>
                            <SelectItem value="other">Other</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                      <div>
                        <Label>Item Condition</Label>
                        <Select value={item.condition} onValueChange={(value) => updateReturnItemCondition(index, value)}>
                          <SelectTrigger>
                            <SelectValue placeholder="Select condition" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="good">Good - Can be restocked</SelectItem>
                            <SelectItem value="damaged">Damaged - Needs inspection</SelectItem>
                            <SelectItem value="defective">Defective - Cannot restock</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                    </div>
                  )}
                </CardContent>
              </Card>
            ))}
            
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label>Courier Name *</Label>
                <Input
                  value={returnCourierName}
                  onChange={(e) => setReturnCourierName(e.target.value)}
                  placeholder="Enter courier/driver name"
                />
              </div>
              <div>
                <Label>Additional Notes</Label>
                <Textarea
                  value={returnNotes}
                  onChange={(e) => setReturnNotes(e.target.value)}
                  placeholder="Any additional notes..."
                  rows={1}
                />
              </div>
            </div>
          </div>
          
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowReturnDialog(false)} className="bg-transparent">
              Cancel
            </Button>
            <Button
              onClick={handleSubmitReturn}
              disabled={submittingReturn || returnItems.every((item) => item.quantityReturned === 0)}
              className="bg-orange-600 hover:bg-orange-700"
            >
              {submittingReturn ? "Submitting..." : "Submit Return Request"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
