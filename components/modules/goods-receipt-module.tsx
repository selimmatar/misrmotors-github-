"use client"

import { useState, useRef, useEffect } from "react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Input } from "@/components/ui/input"
import { useAppContext } from "@/lib/app-context"
import { useI18n } from "@/lib/i18n-context"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import {
  CheckCircle,
  XCircle,
  AlertCircle,
  Clock,
  CalendarDays,
  Camera,
  X,
  ImageIcon,
  Package,
  Plus,
  Warehouse,
  FileText,
} from "lucide-react"

interface ItemPhoto {
  productId: string
  productName: string
  file: File | null
  preview: string | null
  uploading: boolean
  uploaded: boolean
  error: string | null
}

interface WarehouseAllocation {
  warehouseId: string
  warehouseName: string
  quantity: number
}

interface ReceiptLineItem {
  productId: string
  poItemId: string
  productName: string
  itemType: 'stock' | 'outsourced'
  quantityOrdered: number // quantity still open on the order (ordered minus earlier receipts)
  alreadyReceived: number
  quantityReceived: number
  unitPrice: number
  discrepancyType: '' | 'missing' | 'damaged' | 'wrong_item' | 'quantity_mismatch' | 'other'
  discrepancyNotes: string
  warehouseAllocations: WarehouseAllocation[]
}

interface WarehouseType {
  id: number
  name: string
  location: string
  address?: string
  contactPerson?: string
  contactPhone?: string
  isDefault: boolean
  isActive: boolean
}

export function GoodsReceiptModule() {
  const { t, formatNumber, formatCurrency, language } = useI18n()
  const { purchaseOrders, updatePurchaseOrder, products, suppliers, loadData, user, warehouses: warehousesFromContext } = useAppContext()

  const [showRejectModal, setShowRejectModal] = useState(false)
  const [selectedPOForRejection, setSelectedPOForRejection] = useState<any>(null)
  const [rejectionReason, setRejectionReason] = useState("")

  const [showPhotoModal, setShowPhotoModal] = useState(false)
  const [selectedPOForPhotos, setSelectedPOForPhotos] = useState<any>(null)
  const [itemPhotos, setItemPhotos] = useState<ItemPhoto[]>([])
  const [photoNotes, setPhotoNotes] = useState<Record<string, string>>({})
  const [receiptLines, setReceiptLines] = useState<ReceiptLineItem[]>([])
  const fileInputRefs = useRef<Record<string, HTMLInputElement | null>>({})
  // One idempotency key per receipt dialog: a double click / retry of the same submission can never create a second GRN
  const receiveKeyRef = useRef<string | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [showAddWarehouseDialog, setShowAddWarehouseDialog] = useState(false) // Declared variable

  const warehouses = warehousesFromContext
  const [selectedWarehouseId, setSelectedWarehouseId] = useState<string>("default")

  // approved and partially received orders are open for receiving (the server makes the final decision)
  const approvedPOs = purchaseOrders.filter((po) => ["approved", "partially_received"].includes(po.status as string))

  useEffect(() => {
    // Set default warehouse if available
    const defaultWarehouse = warehouses.find((w: any) => w.isDefault)
    if (defaultWarehouse) {
      setSelectedWarehouseId(String(defaultWarehouse.id))
    } else if (warehouses.length > 0) {
      setSelectedWarehouseId(String(warehouses[0].id))
    }
  }, [warehouses])

  // Warehouse management moved to inventory module

  const getSupplierName = (supplierId: string) => {
    const supplier = suppliers.find((s) => s.id === supplierId)
    return supplier?.name || "Unknown Supplier"
  }

  const getSupplierLeadTime = (supplierId: string): number => {
    const supplier = suppliers.find((s) => s.id === supplierId)
    return supplier?.leadTimeDays || 14
  }

  const calculateETA = (orderDate: string, supplierId: string): { date: string; daysRemaining: number } => {
    const leadTimeDays = getSupplierLeadTime(supplierId)
    const orderDateObj = new Date(orderDate)
    const etaDate = new Date(orderDateObj)
    etaDate.setDate(etaDate.getDate() + leadTimeDays)

    const today = new Date()
    today.setHours(0, 0, 0, 0)
    const daysRemaining = Math.ceil((etaDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24))

    return {
      date: etaDate.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }),
      daysRemaining,
    }
  }

  const initializePhotoState = async (po: any) => {
    const photos: ItemPhoto[] = po.items.map((item: any) => ({
      productId: item.productId,
      productName: item.productName,
      file: null,
      preview: null,
      uploading: false,
      uploaded: false,
      error: null,
    }))
    
    // Get default warehouse
    const defaultWh = warehouses.find((w: any) => w.isDefault) || warehouses[0]
    
    // Earlier receipts for this order (display only - the server recalculates the remaining quantity itself)
    const receivedByItem: Record<string, number> = {}
    try {
      const res = await fetch(`/api/goods-receipts?po_id=${encodeURIComponent(String(po.id))}`)
      if (res.ok) {
        const receipts = await res.json()
        for (const r of Array.isArray(receipts) ? receipts : []) {
          for (const l of r.lines || []) {
            if (l.poItemId) receivedByItem[String(l.poItemId)] = (receivedByItem[String(l.poItemId)] || 0) + (Number(l.quantityReceived) || 0)
          }
        }
      }
    } catch (e) {
      console.error('Could not load earlier receipts for this order', e)
    }

    const lines: ReceiptLineItem[] = po.items.map((item: any) => {
      const ordered = Number(item.quantity) || 0
      const already = receivedByItem[String(item.id)] || 0
      const qty = Math.max(0, ordered - already)
      // Trust the item's actual item_type. A stock item without a matching catalog
      // product (manually typed on the PO) is still a stock item — it must still be
      // allocated to a warehouse and added to inventory, not silently dropped as "outsourced".
      const isOutsourced = item.itemType === 'outsourced'
      return {
        productId: item.productId || item.id || String(Math.random()),
        poItemId: item.id ? String(item.id) : '',
        productName: item.productName || item.outsourcedName || 'Unknown',
        itemType: isOutsourced ? 'outsourced' : 'stock',
        quantityOrdered: qty,
        alreadyReceived: already,
        quantityReceived: qty,
        unitPrice: item.unitPrice,
        discrepancyType: '',
        discrepancyNotes: '',
        // Outsourced items don't need warehouse allocation
        warehouseAllocations: isOutsourced ? [] : (defaultWh ? [{
          warehouseId: String(defaultWh.id),
          warehouseName: defaultWh.name,
          quantity: qty
        }] : [])
      }
    }).filter((l: ReceiptLineItem) => l.quantityOrdered > 0)

    if (lines.length === 0) {
      alert('Every item on this purchase order has already been received.')
      return
    }

    receiveKeyRef.current =
      typeof crypto !== 'undefined' && 'randomUUID' in crypto
        ? crypto.randomUUID()
        : `rcv-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
    setItemPhotos(photos)
    setReceiptLines(lines)
    setPhotoNotes({})
    setSelectedPOForPhotos(po)
    setShowPhotoModal(true)
  }

  const handlePhotoSelect = (productId: string, file: File | null) => {
    if (!file) return

    if (!file.type.startsWith("image/")) {
      setItemPhotos((prev) =>
        prev.map((p) => (p.productId === productId ? { ...p, error: t("gr.invalid-file-type") } : p)),
      )
      return
    }

    if (file.size > 5 * 1024 * 1024) {
      setItemPhotos((prev) =>
        prev.map((p) => (p.productId === productId ? { ...p, error: t("gr.file-too-large") } : p)),
      )
      return
    }

    const preview = URL.createObjectURL(file)
    setItemPhotos((prev) => prev.map((p) => (p.productId === productId ? { ...p, file, preview, error: null } : p)))
  }

  const removePhoto = (productId: string) => {
    setItemPhotos((prev) =>
      prev.map((p) => {
        if (p.productId === productId && p.preview) {
          URL.revokeObjectURL(p.preview)
        }
        return p.productId === productId ? { ...p, file: null, preview: null, error: null } : p
      }),
    )
  }

  const uploadPhotos = async () => {
    const photosToUpload = itemPhotos.filter((p) => p.file && !p.uploaded)

    for (const photo of photosToUpload) {
      setItemPhotos((prev) => prev.map((p) => (p.productId === photo.productId ? { ...p, uploading: true } : p)))

      try {
        const formData = new FormData()
        formData.append("file", photo.file!)
        formData.append("productId", photo.productId)
        formData.append("uploadedBy", user?.id || "")
        formData.append("poId", selectedPOForPhotos?.id || "")
        formData.append("poNumber", selectedPOForPhotos?.poNumber || "")
        formData.append("notes", photoNotes[photo.productId] || "")

        const response = await fetch("/api/product-images", {
          method: "POST",
          body: formData,
        })

        if (!response.ok) {
          throw new Error("Upload failed")
        }

        setItemPhotos((prev) =>
          prev.map((p) => (p.productId === photo.productId ? { ...p, uploading: false, uploaded: true } : p)),
        )
      } catch (error) {
        setItemPhotos((prev) =>
          prev.map((p) =>
            p.productId === photo.productId ? { ...p, uploading: false, error: t("gr.upload-failed") } : p,
          ),
        )
      }
    }
  }

  const handleAcceptWithPhotos = async () => {
    if (isSubmitting) return // a second click while the first request is running does nothing

    // Only validate warehouse allocation for stock items (not outsourced)
    for (const line of receiptLines) {
      if (line.itemType === 'outsourced') continue
      const totalAllocated = line.warehouseAllocations.reduce((sum, a) => sum + a.quantity, 0)
      if (totalAllocated !== line.quantityReceived) {
        alert(`${line.productName}: Allocated quantity (${totalAllocated}) doesn't match received quantity (${line.quantityReceived})`)
        return
      }
    }

    // Lines that were not received in this delivery are simply not part of this receipt
    // (the server only accepts positive quantities, and the order stays open for the rest).
    const lineSpecs = receiptLines.filter((line) => line.quantityReceived > 0)
    if (lineSpecs.length === 0) {
      alert('Enter a received quantity greater than zero for at least one item.')
      return
    }

    setIsSubmitting(true)
    try {
      const hasPhotosToUpload = itemPhotos.some((p) => p.file && !p.uploaded)
      if (hasPhotosToUpload) {
        await uploadPhotos()
      }

      const allLines: any[] = []

      for (const line of lineSpecs) {
        if (line.itemType === 'outsourced') {
          // Outsourced services: single line, no warehouse
          allLines.push({
            poItemId: line.poItemId,
            itemType: 'outsourced',
            quantityReceived: line.quantityReceived,
            unitCost: line.unitPrice,
          })
        } else {
          // Stock items: one line per warehouse allocation. The server resolves product, SO link and cost
          // basis from the purchase order item itself.
          for (const allocation of line.warehouseAllocations) {
            if (allocation.quantity > 0) {
              allLines.push({
                poItemId: line.poItemId,
                productName: line.productName,
                itemType: 'stock',
                quantityReceived: allocation.quantity,
                discrepancyType: line.discrepancyType && line.discrepancyType !== 'none' ? line.discrepancyType : null,
                discrepancyNotes: line.discrepancyNotes || null,
                warehouseId: allocation.warehouseId,
                unitCost: line.unitPrice,
              })
            }
          }
        }
      }

      const response = await fetch('/api/goods-receipts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          poId: selectedPOForPhotos.id,
          receivedBy: user?.id,
          notes: selectedPOForPhotos.notes || '',
          idempotencyKey: receiveKeyRef.current,
          lines: allLines,
        }),
      })

      const result = await response.json().catch(() => ({}))
      if (!response.ok) {
        // The server is the authority: show its reason and keep the dialog open so nothing is lost.
        // The same idempotency key stays valid for a retry of the same submission.
        throw new Error(result.error || 'Failed to create goods receipt')
      }

      await loadData()
      alert(`Goods received successfully! GRN: ${result.receipt.grnNumber}${result.poStatus === 'partially_received' ? ' (order partially received - the rest can still be received)' : ''}`)
    } catch (error: any) {
      console.error('Error creating goods receipt:', error)
      alert(`Error: ${error.message}`)
      setIsSubmitting(false)
      return
    }

    receiveKeyRef.current = null
    setIsSubmitting(false)
    setShowPhotoModal(false)
    setSelectedPOForPhotos(null)
    setItemPhotos([])
    setPhotoNotes({})
    setReceiptLines([])
  }

  const handleRejectReceipt = () => {
    if (!rejectionReason.trim()) {
      alert(`${t("gr.please-provide-reason")}`)
      return
    }

    updatePurchaseOrder({
      ...selectedPOForRejection,
      status: "rejected" as const,
      rejectionReason: rejectionReason,
      rejectedAt: new Date().toISOString(),
    })

    setShowRejectModal(false)
    setSelectedPOForRejection(null)
    setRejectionReason("")
    alert(`${t("gr.po-rejected")}: ${selectedPOForRejection.poNumber}. ${t("gr.po-rep-ceo-notified")}`)
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold">{t("gr.title")}</h1>
        <p className="text-muted-foreground mt-2">{t("gr.description")}</p>
        <p className="text-sm font-semibold mt-2 text-blue-600">
          {formatNumber(approvedPOs.length)} {t("gr.awaiting-receipt")}
        </p>
      </div>

      {approvedPOs.length === 0 ? (
        <Card className="border-yellow-200 bg-yellow-50">
          <CardContent className="pt-6">
            <div className="flex items-start gap-3">
              <AlertCircle className="w-5 h-5 text-yellow-600 mt-0.5" />
              <div>
                <h3 className="font-semibold text-yellow-900">{t("gr.no-approved-po")}</h3>
                <p className="text-sm text-yellow-700 mt-1">{t("gr.no-approved-po-description")}</p>
              </div>
            </div>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4">
          {approvedPOs.map((po) => {
            const eta = calculateETA(po.orderDate, po.supplierId)
            const leadTime = getSupplierLeadTime(po.supplierId)

            return (
              <Card key={po.id}>
                <CardHeader>
                  <div className="flex items-start justify-between">
                    <div>
                      <CardTitle className="text-lg">{po.poNumber}</CardTitle>
                      <p className="text-sm text-muted-foreground mt-1">
                        {t("gr.supplier")}: {getSupplierName(po.supplierId)}
                      </p>
                      <p className="text-sm text-muted-foreground">
                        {t("gr.order-date")}: {po.orderDate} | {t("gr.expected")}: {po.deliveryDate || t("gr.tbd")}
                      </p>
                      <div className="flex items-center gap-4 mt-2">
                        <div className="flex items-center gap-1.5 text-sm">
                          <Clock className="w-4 h-4 text-blue-500" />
                          <span className="text-muted-foreground">{t("gr.lead-time")}:</span>
                          <span className="font-medium">
                            {formatNumber(leadTime)} {t("gr.days")}
                          </span>
                        </div>
                        <div className="flex items-center gap-1.5 text-sm">
                          <CalendarDays className="w-4 h-4 text-green-500" />
                          <span className="text-muted-foreground">{t("gr.eta")}:</span>
                          <span
                            className={`font-semibold ${eta.daysRemaining <= 0 ? "text-red-600" : eta.daysRemaining <= 3 ? "text-orange-600" : "text-green-600"}`}
                          >
                            {eta.date}
                            {eta.daysRemaining <= 0
                              ? ` (${t("gr.overdue")})`
                              : eta.daysRemaining === 1
                                ? ` (${t("gr.tomorrow")})`
                                : ` (${formatNumber(eta.daysRemaining)} ${t("gr.days")})`}
                          </span>
                        </div>
                      </div>
                    </div>
                    <div className="text-right">
                      <p className="text-2xl font-bold">{formatCurrency(po.total)}</p>
                      <span className="inline-block px-2 py-1 rounded text-xs font-semibold bg-green-100 text-green-800 mt-1">
                        {t(`po.status.${po.status}`)}
                      </span>
                    </div>
                  </div>
                </CardHeader>
                <CardContent>
                  <div className="space-y-3">
                    <div>
                      <h4 className="font-semibold text-sm mb-2">{t("gr.items-to-receive")}:</h4>
                      <div className="space-y-2">
                        {po.items.map((item: any) => (
                          <div key={item.id} className="flex justify-between items-center p-2 bg-muted/50 rounded">
                            <div>
                              <p className="font-medium text-sm">{item.productName}</p>
                              <p className="text-xs text-muted-foreground">
                                {t("field.quantity")}: {formatNumber(item.quantity)} {t("gr.units")} @{" "}
                                {formatCurrency(item.unitPrice)}/{t("gr.unit")}
                              </p>
                            </div>
                            <p className="font-semibold text-sm">{formatCurrency(item.total)}</p>
                          </div>
                        ))}
                      </div>
                    </div>

                    <div className="flex gap-2 pt-4 border-t flex-wrap">
                      <Button onClick={() => initializePhotoState(po)} className="gap-2">
                        <CheckCircle className="w-4 h-4" />
                        {t("gr.receive-po")}
                      </Button>
                      <Button
                        variant="destructive"
                        onClick={() => {
                          setSelectedPOForRejection(po)
                          setShowRejectModal(true)
                        }}
                        className="gap-2"
                      >
                        <XCircle className="w-4 h-4" />
                        {t("gr.reject-receipt")}
                      </Button>
                      {po.poInvoiceUrl ? (
                        <Button
                          variant="outline"
                          onClick={() => window.open(po.poInvoiceUrl, "_blank")}
                          className="gap-2"
                        >
                          <FileText className="w-4 h-4" />
                          View PO PDF
                        </Button>
                      ) : (
                        <Button
                          variant="ghost"
                          disabled
                          className="gap-2 opacity-50"
                          title="No PO PDF uploaded"
                        >
                          <FileText className="w-4 h-4" />
                          No PDF
                        </Button>
                      )}
                    </div>
                  </div>
                </CardContent>
              </Card>
            )
          })}
        </div>
      )}

      {/* Reject Modal */}
      <Dialog open={showRejectModal} onOpenChange={setShowRejectModal}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {t("gr.reject-title")} {selectedPOForRejection?.poNumber}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="rejection-reason">{t("gr.rejection-reason")} *</Label>
              <Textarea
                id="rejection-reason"
                placeholder={t("gr.rejection-placeholder")}
                value={rejectionReason}
                onChange={(e) => setRejectionReason(e.target.value)}
                rows={4}
                className="resize-none"
              />
            </div>
            <p className="text-sm text-muted-foreground">{t("gr.rejection-note")}</p>
          </div>
          <div className="flex justify-end gap-2">
            <Button
              variant="outline"
              onClick={() => {
                setShowRejectModal(false)
                setSelectedPOForRejection(null)
                setRejectionReason("")
              }}
            >
              {t("action.cancel")}
            </Button>
            <Button variant="destructive" onClick={handleRejectReceipt} disabled={!rejectionReason.trim()}>
              {t("gr.confirm-rejection")}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Photo & Warehouse Selection Modal */}
      <Dialog open={showPhotoModal} onOpenChange={setShowPhotoModal}>
        <DialogContent className="sm:max-w-3xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Package className="w-5 h-5" />
              {t("gr.receive-po")} - {selectedPOForPhotos?.poNumber}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <p className="text-sm text-muted-foreground">{t("gr.receive-po-description")}</p>

            <div className="space-y-4">
              {/* Outsourced Services Section */}
              {receiptLines.some(l => l.itemType === 'outsourced') && (
                <div className="space-y-3">
                  <h4 className="font-semibold text-sm flex items-center gap-2">
                    <FileText className="w-4 h-4 text-amber-600" />
                    Outsourced Services
                    <span className="text-xs font-normal text-muted-foreground">(no warehouse allocation needed)</span>
                  </h4>
                  {receiptLines
                    .filter(l => l.itemType === 'outsourced')
                    .map((line, index) => {
                      const globalIndex = receiptLines.indexOf(line)
                      return (
                        <Card key={line.productId} className="p-4 border-amber-200 bg-amber-50/50">
                          <div className="flex items-center justify-between gap-4">
                            <div className="flex-1">
                              <p className="font-medium">{line.productName}</p>
                              <p className="text-sm text-muted-foreground">Outsourced service — Ordered: {line.quantityOrdered + line.alreadyReceived}{line.alreadyReceived > 0 ? ` (already received ${line.alreadyReceived}, remaining ${line.quantityOrdered})` : ''}</p>
                            </div>
                            <div className="flex items-center gap-3">
                              <Label htmlFor={`outsourced-qty-${globalIndex}`} className="text-sm">Qty Received</Label>
                              <Input
                                id={`outsourced-qty-${globalIndex}`}
                                type="number"
                                min="0"
                                max={line.quantityOrdered}
                                value={line.quantityReceived}
                                onChange={(e) => {
                                  const newQty = parseInt(e.target.value) || 0
                                  setReceiptLines(prev => prev.map((l, i) =>
                                    i === globalIndex ? { ...l, quantityReceived: newQty } : l
                                  ))
                                }}
                                className="w-20"
                              />
                            </div>
                          </div>
                        </Card>
                      )
                    })}
                </div>
              )}

              {/* Stock Items Section */}
              {receiptLines.some(l => l.itemType !== 'outsourced') && (
                <div className="space-y-3">
                  <h4 className="font-semibold text-sm flex items-center gap-2">
                    <Package className="w-4 h-4" />
                    Stock Items
                  </h4>
                  <p className="text-sm text-muted-foreground">
                    For each item, select which warehouse(s) to receive the quantity into. You can split quantities across multiple warehouses.
                  </p>
                  {receiptLines
                    .filter(l => l.itemType !== 'outsourced')
                    .map((line) => {
                      const globalIndex = receiptLines.indexOf(line)
                      return (
                        <Card key={line.productId} className="p-4">
                          <div className="space-y-4">
                            <div className="flex items-start justify-between">
                              <div>
                                <p className="font-medium">{line.productName}</p>
                                <p className="text-sm text-muted-foreground">Ordered: {line.quantityOrdered + line.alreadyReceived} units{line.alreadyReceived > 0 ? ` (already received ${line.alreadyReceived}, remaining ${line.quantityOrdered})` : ''}</p>
                              </div>
                            </div>

                            <div className="grid grid-cols-2 gap-3">
                              <div className="space-y-1.5">
                                <Label htmlFor={`qty-${line.productId}`}>Quantity Received *</Label>
                                <Input
                                  id={`qty-${line.productId}`}
                                  type="number"
                                  min="0"
                                  max={line.quantityOrdered}
                                  value={line.quantityReceived}
                                  onChange={(e) => {
                                    const newQty = parseInt(e.target.value) || 0
                                    setReceiptLines(prev => prev.map((l, i) => {
                                      if (i !== globalIndex) return l
                                      const updatedAllocations = l.warehouseAllocations.length === 1
                                        ? [{ ...l.warehouseAllocations[0], quantity: newQty }]
                                        : l.warehouseAllocations
                                      return { ...l, quantityReceived: newQty, warehouseAllocations: updatedAllocations }
                                    }))
                                  }}
                                  className="w-full"
                                />
                              </div>
                              <div className="space-y-1.5">
                                <Label htmlFor={`issue-${line.productId}`}>Issue Type</Label>
                                <Select
                                  value={line.discrepancyType || "none"}
                                  onValueChange={(value) => {
                                    setReceiptLines(prev => prev.map((l, i) =>
                                      i === globalIndex ? { ...l, discrepancyType: value as any } : l
                                    ))
                                  }}
                                >
                                  <SelectTrigger id={`issue-${line.productId}`}>
                                    <SelectValue placeholder="No issue" />
                                  </SelectTrigger>
                                  <SelectContent>
                                    <SelectItem value="none">No issue</SelectItem>
                                    <SelectItem value="missing">Missing</SelectItem>
                                    <SelectItem value="damaged">Damaged</SelectItem>
                                    <SelectItem value="wrong_item">Wrong Item</SelectItem>
                                    <SelectItem value="quantity_mismatch">Quantity Mismatch</SelectItem>
                                    <SelectItem value="other">Other</SelectItem>
                                  </SelectContent>
                                </Select>
                              </div>
                            </div>

                            {line.discrepancyType && line.discrepancyType !== 'none' && (
                              <div className="space-y-1.5">
                                <Label htmlFor={`notes-${line.productId}`}>Issue Details *</Label>
                                <Textarea
                                  id={`notes-${line.productId}`}
                                  placeholder="Describe the issue..."
                                  value={line.discrepancyNotes}
                                  onChange={(e) => {
                                    setReceiptLines(prev => prev.map((l, i) =>
                                      i === globalIndex ? { ...l, discrepancyNotes: e.target.value } : l
                                    ))
                                  }}
                                  rows={2}
                                  className="resize-none"
                                />
                              </div>
                            )}

                            {/* Warehouse Allocation Section */}
                            <div className="space-y-2 p-3 bg-blue-50 rounded-lg border border-blue-200">
                              <div className="flex items-center justify-between">
                                <Label className="flex items-center gap-2 font-medium">
                                  <Warehouse className="w-4 h-4" />
                                  Warehouse Allocation
                                </Label>
                                <Button
                                  type="button"
                                  variant="outline"
                                  size="sm"
                                  onClick={() => {
                                    const availableWarehouses = warehouses.filter(
                                      w => !line.warehouseAllocations.some(a => a.warehouseId === String(w.id))
                                    )
                                    const nextWh = availableWarehouses[0] || warehouses[0]
                                    if (!nextWh) return
                                    const currentAllocations = line.warehouseAllocations
                                    const lastAlloc = currentAllocations[currentAllocations.length - 1]
                                    const splitQty = Math.floor(lastAlloc.quantity / 2)
                                    const remainder = lastAlloc.quantity - splitQty
                                    setReceiptLines(prev => prev.map((l, i) =>
                                      i === globalIndex ? {
                                        ...l,
                                        warehouseAllocations: [
                                          ...currentAllocations.slice(0, -1),
                                          { ...lastAlloc, quantity: remainder },
                                          { warehouseId: String(nextWh.id), warehouseName: nextWh.name, quantity: splitQty }
                                        ]
                                      } : l
                                    ))
                                  }}
                                  className="h-7 text-xs"
                                  disabled={warehouses.length < 2}
                                  title={warehouses.length < 2 ? "Add more warehouses to enable splitting" : ""}
                                >
                                  <Plus className="w-3 h-3 mr-1" />
                                  Split to Another Warehouse
                                </Button>
                              </div>

                              {line.warehouseAllocations.map((allocation, allocIndex) => (
                                <div key={allocIndex} className="flex items-center gap-2">
                                  <Select
                                    value={allocation.warehouseId}
                                    onValueChange={(value) => {
                                      const wh = warehouses.find(w => String(w.id) === value)
                                      setReceiptLines(prev => prev.map((l, i) =>
                                        i === globalIndex ? {
                                          ...l,
                                          warehouseAllocations: l.warehouseAllocations.map((a, ai) =>
                                            ai === allocIndex ? { ...a, warehouseId: value, warehouseName: wh?.name || '' } : a
                                          )
                                        } : l
                                      ))
                                    }}
                                  >
                                    <SelectTrigger className="flex-1">
                                      <SelectValue placeholder="Select warehouse" />
                                    </SelectTrigger>
                                    <SelectContent>
                                      {warehouses.map((wh) => (
                                        <SelectItem key={wh.id} value={String(wh.id)}>
                                          {wh.name} {wh.isDefault && "(Default)"}
                                        </SelectItem>
                                      ))}
                                    </SelectContent>
                                  </Select>
                                  <Input
                                    type="number"
                                    min="0"
                                    max={line.quantityReceived}
                                    value={allocation.quantity}
                                    onChange={(e) => {
                                      const qty = parseInt(e.target.value) || 0
                                      setReceiptLines(prev => prev.map((l, i) =>
                                        i === globalIndex ? {
                                          ...l,
                                          warehouseAllocations: l.warehouseAllocations.map((a, ai) =>
                                            ai === allocIndex ? { ...a, quantity: qty } : a
                                          )
                                        } : l
                                      ))
                                    }}
                                    className="w-24"
                                    placeholder="Qty"
                                  />
                                  {line.warehouseAllocations.length > 1 && (
                                    <Button
                                      type="button"
                                      variant="ghost"
                                      size="sm"
                                      onClick={() => {
                                        setReceiptLines(prev => prev.map((l, i) =>
                                          i === globalIndex ? {
                                            ...l,
                                            warehouseAllocations: l.warehouseAllocations.filter((_, ai) => ai !== allocIndex)
                                          } : l
                                        ))
                                      }}
                                      className="h-8 w-8 p-0 text-red-500 hover:text-red-700"
                                    >
                                      <X className="w-4 h-4" />
                                    </Button>
                                  )}
                                </div>
                              ))}

                              {(() => {
                                const totalAllocated = line.warehouseAllocations.reduce((sum, a) => sum + a.quantity, 0)
                                const remaining = line.quantityReceived - totalAllocated
                                return remaining !== 0 ? (
                                  <p className={`text-xs ${remaining > 0 ? 'text-amber-600' : 'text-red-600'}`}>
                                    {remaining > 0
                                      ? `${remaining} units not yet allocated to a warehouse`
                                      : `Over-allocated by ${Math.abs(remaining)} units`}
                                  </p>
                                ) : (
                                  <p className="text-xs text-green-600">All {totalAllocated} units allocated</p>
                                )
                              })()}
                            </div>

                            {/* Photo Upload Section */}
                            <div className="flex items-start gap-3 pt-2 border-t">
                              <div className="flex-shrink-0">
                                {itemPhotos.find(p => p.productId === line.productId)?.preview ? (
                                  <div className="relative w-20 h-20">
                                    <img
                                      src={itemPhotos.find(p => p.productId === line.productId)?.preview || "/placeholder.svg"}
                                      alt={line.productName}
                                      className="w-20 h-20 object-cover rounded border"
                                    />
                                    {!itemPhotos.find(p => p.productId === line.productId)?.uploaded && (
                                      <button
                                        onClick={() => removePhoto(line.productId)}
                                        className="absolute -top-1 -right-1 bg-red-500 text-white rounded-full p-0.5 hover:bg-red-600"
                                      >
                                        <X className="w-3 h-3" />
                                      </button>
                                    )}
                                  </div>
                                ) : (
                                  <button
                                    onClick={() => fileInputRefs.current[line.productId]?.click()}
                                    className="w-20 h-20 border-2 border-dashed rounded flex flex-col items-center justify-center gap-1 hover:bg-muted/50 transition-colors"
                                  >
                                    <Camera className="w-4 h-4 text-muted-foreground" />
                                    <span className="text-[10px] text-muted-foreground">Add Photo</span>
                                  </button>
                                )}
                                <input
                                  type="file"
                                  accept="image/*"
                                  className="hidden"
                                  ref={(el) => { fileInputRefs.current[line.productId] = el }}
                                  onChange={(e) => handlePhotoSelect(line.productId, e.target.files?.[0] || null)}
                                />
                              </div>
                              <div className="flex-1">
                                <Label htmlFor={`photo-notes-${line.productId}`} className="text-xs">Photo Notes</Label>
                                <Input
                                  id={`photo-notes-${line.productId}`}
                                  placeholder="Optional notes about photo..."
                                  value={photoNotes[line.productId] || ""}
                                  onChange={(e) =>
                                    setPhotoNotes((prev) => ({ ...prev, [line.productId]: e.target.value }))
                                  }
                                  className="text-sm mt-1"
                                />
                              </div>
                            </div>
                          </div>
                        </Card>
                      )
                    })}
                </div>
              )}
            </div>

            <div className="flex justify-end gap-2 pt-4 border-t">
              <Button
                variant="outline"
                onClick={() => {
                  setShowPhotoModal(false)
                  setSelectedPOForPhotos(null)
                  setItemPhotos([])
                  setPhotoNotes({})
                }}
              >
                {t("action.cancel")}
              </Button>
              <Button onClick={handleAcceptWithPhotos} disabled={!selectedWarehouseId || isSubmitting} className="gap-2">
                <CheckCircle className="w-4 h-4" />
                {t("gr.confirm-receipt")}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
