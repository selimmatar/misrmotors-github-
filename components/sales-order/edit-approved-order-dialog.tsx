"use client"

import { useEffect, useMemo, useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from "@/components/ui/dialog"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Badge } from "@/components/ui/badge"
import { AlertTriangle, Package, Trash2, UserPlus } from "lucide-react"
import { useAppContext } from "@/lib/app-context"
import { useI18n } from "@/lib/i18n-context"
import { ProductSearchCombobox } from "@/components/product-search-combobox"
import { DiscountFields, calculateDiscount, type DiscountType } from "@/components/discount"
import { PaymentTypeSelector, InstallmentFields, ChequeFields } from "@/components/payment"
import type { SalesOrder, PaymentType, PaymentDetails, ItemCategory } from "@/lib/types"

interface EditItem {
  key: string
  id?: string
  itemType: "stock" | "outsourced"
  itemCategory: ItemCategory
  productId: string
  productName: string
  outsourcedUnit: string
  supplierId: string
  supplierName: string
  quantity: number
  unitPrice: number
}

interface EditApprovedOrderDialogProps {
  order: SalesOrder
  onOpenChange: (open: boolean) => void
  onSaved: () => void
}

let rowKeyCounter = 0
function nextRowKey() {
  rowKeyCounter += 1
  return `row-${Date.now()}-${rowKeyCounter}`
}

export function EditApprovedOrderDialog({ order, onOpenChange, onSaved }: EditApprovedOrderDialogProps) {
  const { customers, products, suppliers, inventory, updateSalesOrder } = useAppContext()
  const { formatCurrency, t } = useI18n()

  const [customerId, setCustomerId] = useState(order.customerId)
  const [deliveryAddress, setDeliveryAddress] = useState(order.deliveryAddress || "")
  const [deliveryContactName, setDeliveryContactName] = useState(order.deliveryContactName || "")
  const [deliveryContactPhone, setDeliveryContactPhone] = useState(order.deliveryContactPhone || "")
  const [notes, setNotes] = useState(order.notes || "")

  const [items, setItems] = useState<EditItem[]>(() =>
    (order.items || []).map((item: any) => ({
      key: nextRowKey(),
      id: item.id,
      itemType: item.itemType === "outsourced" || item.item_type === "outsourced" ? "outsourced" : "stock",
      itemCategory: (item.itemCategory as ItemCategory) || "EQUIPMENT",
      productId: item.productId || "",
      productName: item.productName || item.outsourcedName || "",
      outsourcedUnit: item.outsourcedUnit || "unit",
      supplierId: item.supplierId || "",
      supplierName: item.supplierName || "",
      quantity: item.quantity || 0,
      unitPrice: item.unitPrice || 0,
    })),
  )

  const [discountType, setDiscountType] = useState<DiscountType>((order.discountType as DiscountType) || "none")
  const [discountValue, setDiscountValue] = useState<number>(order.discountValue || 0)

  const isHybrid = order.paymentType === "hybrid"
  const [paymentType, setPaymentType] = useState<PaymentType>(order.paymentType || "cash")
  const [paymentDetails, setPaymentDetails] = useState<PaymentDetails>(
    order.paymentDetails || {
      paymentType: order.paymentType || "cash",
      installmentMonths: order.installments || 6,
      monthlyAmount: 0,
      chequeNumber: "",
      chequeBankName: "",
      chequeDueDate: "",
      chequeAmount: 0,
      chequeNotes: "",
      downPaymentType: "cash",
      downPaymentAmount: 0,
      downPaymentPercent: 50,
      remainingAmount: 0,
      remainingInstallmentMonths: 6,
      downPaymentChequeNumber: "",
      downPaymentChequeBank: "",
      downPaymentChequeDueDate: "",
      paymentStartDate: new Date().toISOString().split("T")[0],
      downPaymentDueDate: new Date().toISOString().split("T")[0],
    } as PaymentDetails,
  )

  const handlePaymentDetailChange = (field: string, value: string | number) => {
    setPaymentDetails((prev) => ({ ...prev, [field]: value }))
  }

  const [itemPoStatus, setItemPoStatus] = useState<Record<string, { poNumber: string; status: string }>>({})
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    let cancelled = false
    async function loadPoStatus() {
      try {
        const res = await fetch(`/api/sales-orders/item-po-status?soId=${(order as any).soId ?? order.id}`)
        if (!res.ok) return
        const data = await res.json()
        if (!cancelled) setItemPoStatus(data.itemPoStatus || {})
      } catch {
        // Non-critical - just skip the "already ordered" warning if this fails
      }
    }
    loadPoStatus()
    return () => {
      cancelled = true
    }
  }, [order])

  const aggregatedInventory = useMemo(() => {
    const totals = new Map<string, number>()
    for (const inv of inventory) {
      if ((inv as any).isReturned) continue
      totals.set(inv.productId, (totals.get(inv.productId) || 0) + (inv.quantity || 0))
    }
    return Array.from(totals.entries()).map(([productId, quantity]) => ({ productId, quantity }))
  }, [inventory])

  const addItem = (itemType: "stock" | "outsourced") => {
    setItems((prev) => [
      ...prev,
      {
        key: nextRowKey(),
        itemType,
        itemCategory: "EQUIPMENT",
        productId: "",
        productName: "",
        outsourcedUnit: "unit",
        supplierId: "",
        supplierName: "",
        quantity: 1,
        unitPrice: 0,
      },
    ])
  }

  const updateItem = (key: string, patch: Partial<EditItem>) => {
    setItems((prev) => prev.map((item) => (item.key === key ? { ...item, ...patch } : item)))
  }

  const removeItem = (row: EditItem) => {
    if (row.id && itemPoStatus[row.id]) {
      const status = itemPoStatus[row.id]
      const confirmed = window.confirm(
        `This item is already sourced in purchase order ${status.poNumber} (${status.status}). Removing it here will NOT cancel that purchase order. Continue anyway?`,
      )
      if (!confirmed) return
    }
    setItems((prev) => prev.filter((item) => item.key !== row.key))
  }

  const handleSelectStockProduct = (key: string, productId: string) => {
    const product = products.find((p) => p.id === productId)
    updateItem(key, {
      productId,
      productName: product?.productName || "",
      unitPrice: product?.unitPrice || 0,
    })
  }

  // Matches the same 14% VAT applied when the order was first created (sales-order-module.tsx):
  // subtotal is post-discount/pre-VAT, and total/netTotal includes VAT on top of that.
  const VAT_RATE = 0.14
  const subtotal = items.reduce((sum, item) => sum + item.quantity * item.unitPrice, 0)
  const { discountAmount, netTotal: subtotalAfterDiscount } = calculateDiscount(subtotal, discountType, discountValue)
  const vatAmount = subtotalAfterDiscount * VAT_RATE
  const netTotal = subtotalAfterDiscount + vatAmount

  const getAvailableStock = (productId: string): number | null => {
    if (!productId) return null
    const entry = aggregatedInventory.find((inv) => inv.productId === productId)
    return entry ? entry.quantity : 0
  }

  const handleSave = async () => {
    if (!customerId) {
      alert("Please select a customer")
      return
    }
    if (items.length === 0) {
      alert("Please add at least one item")
      return
    }
    const invalidItem = items.find((item) => {
      if (item.itemType === "stock") return !item.productId || item.quantity <= 0 || item.unitPrice < 0
      return !item.productName.trim() || item.quantity <= 0 || item.unitPrice < 0
    })
    if (invalidItem) {
      alert("Please fill in all item details (product, quantity, and price)")
      return
    }

    const finalPaymentTerms =
      paymentType === "installments" || paymentType === "hybrid"
        ? "installment"
        : "prepaid"

    const payloadItems = items.map((item) => ({
      id: item.id,
      productId: item.itemType === "stock" ? item.productId : "",
      productName: item.itemType === "stock" ? item.productName : item.productName,
      quantity: item.quantity,
      unitPrice: item.unitPrice,
      total: item.quantity * item.unitPrice,
      itemCategory: item.itemCategory,
      itemType: item.itemType,
      outsourced_unit: item.outsourcedUnit,
      supplierId: item.itemType === "outsourced" ? item.supplierId : "",
      supplierName: item.itemType === "outsourced" ? item.supplierName : "",
    }))

    setSaving(true)
    try {
      await updateSalesOrder({
        id: order.id,
        status: order.status,
        notes,
        customerId,
        deliveryAddress,
        deliveryContactName,
        deliveryContactPhone,
        items: payloadItems,
        subtotal: subtotalAfterDiscount,
        discountType,
        discountValue,
        discountAmount,
        total: netTotal,
        paymentTerms: finalPaymentTerms,
        installments: isHybrid ? order.installments : paymentDetails.installmentMonths,
        paymentType,
        paymentDetails: isHybrid ? order.paymentDetails : paymentDetails,
      } as any)
      onSaved()
      onOpenChange(false)
    } catch (error: any) {
      console.error("[v0] Failed to save order edits:", error)
      alert(`Failed to save changes: ${error.message || "Unknown error"}`)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-4xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Edit Sales Order: {order.soNumber}</DialogTitle>
          <DialogDescription>
            This order is already approved. Changes save immediately and the order stays approved.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6 py-2">
          {/* Customer & delivery info */}
          <div className="border rounded-lg p-4 space-y-4">
            <h3 className="font-semibold text-sm">Customer &amp; Delivery</h3>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>{t("field.customer")}</Label>
                <Select value={customerId} onValueChange={setCustomerId}>
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="Select customer" className="truncate" />
                  </SelectTrigger>
                  <SelectContent>
                    {customers.map((c) => (
                      <SelectItem key={c.id} value={c.id}>
                        {c.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Delivery Contact Name</Label>
                <Input value={deliveryContactName} onChange={(e) => setDeliveryContactName(e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label>Delivery Contact Phone</Label>
                <Input value={deliveryContactPhone} onChange={(e) => setDeliveryContactPhone(e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label>Delivery Address</Label>
                <Input value={deliveryAddress} onChange={(e) => setDeliveryAddress(e.target.value)} />
              </div>
            </div>
            <div className="space-y-2">
              <Label>Notes</Label>
              <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} />
            </div>
          </div>

          {/* Items */}
          <div className="border rounded-lg p-4 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="font-semibold text-sm">Items</h3>
              <div className="flex gap-2">
                <Button size="sm" variant="outline" onClick={() => addItem("stock")}>
                  <Package className="h-4 w-4 mr-2" />
                  Add from Inventory
                </Button>
                <Button size="sm" variant="outline" onClick={() => addItem("outsourced")}>
                  <UserPlus className="h-4 w-4 mr-2" />
                  Add Outsourced Item
                </Button>
              </div>
            </div>

            {items.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-6">No items. Add an item above.</p>
            ) : (
              <div className="space-y-3">
                {items.map((item) => {
                  const poStatus = item.id ? itemPoStatus[item.id] : undefined
                  const stockLimit = item.itemType === "stock" ? getAvailableStock(item.productId) : null
                  return (
                    <div key={item.key} className="grid grid-cols-12 gap-3 items-end p-3 border rounded-md">
                      <div className="col-span-1 text-center text-xs text-muted-foreground">
                        {item.itemType === "stock" ? "Stock" : "Outsourced"}
                      </div>
                      {item.itemType === "stock" ? (
                        <div className="col-span-4 space-y-1">
                          <Label className="text-xs">Product</Label>
                          <ProductSearchCombobox
                            products={products.map((p) => ({ id: p.id, productName: p.productName, sku: p.sku }))}
                            inventory={aggregatedInventory}
                            warehouseId="all"
                            value={item.productId || undefined}
                            onSelect={(productId) => handleSelectStockProduct(item.key, productId)}
                          />
                          {stockLimit !== null && (
                            <p className="text-xs text-muted-foreground">{stockLimit} in stock</p>
                          )}
                        </div>
                      ) : (
                        <>
                          <div className="col-span-2 space-y-1">
                            <Label className="text-xs">Item Name</Label>
                            <Input
                              value={item.productName}
                              onChange={(e) => updateItem(item.key, { productName: e.target.value })}
                            />
                          </div>
                          <div className="col-span-2 space-y-1">
                            <Label className="text-xs">Supplier</Label>
                            <Select
                              value={item.supplierName || ""}
                              onValueChange={(value) => {
                                const supplier = suppliers.find((s) => s.name === value)
                                updateItem(item.key, { supplierName: value, supplierId: supplier?.id || "" })
                              }}
                            >
                              <SelectTrigger className="w-full">
                                <SelectValue placeholder="Select supplier" className="truncate" />
                              </SelectTrigger>
                              <SelectContent>
                                {suppliers.map((s) => (
                                  <SelectItem key={s.id} value={s.name}>
                                    {s.name}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </div>
                        </>
                      )}
                      <div className="col-span-2 space-y-1">
                        <Label className="text-xs">Quantity</Label>
                        <Input
                          type="number"
                          min="1"
                          value={item.quantity}
                          onChange={(e) => updateItem(item.key, { quantity: Number(e.target.value) || 0 })}
                        />
                      </div>
                      <div className="col-span-2 space-y-1">
                        <Label className="text-xs">Unit Price</Label>
                        <Input
                          type="number"
                          min="0"
                          step="0.01"
                          value={item.unitPrice}
                          onChange={(e) => updateItem(item.key, { unitPrice: Number(e.target.value) || 0 })}
                        />
                      </div>
                      <div className="col-span-2 space-y-1">
                        <Label className="text-xs">Total</Label>
                        <div className="text-sm font-medium pt-2 whitespace-nowrap">
                          {formatCurrency(item.quantity * item.unitPrice)}
                        </div>
                      </div>
                      <div className="col-span-1 flex justify-end">
                        <Button variant="destructive" size="icon" onClick={() => removeItem(item)}>
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                      {poStatus && (
                        <div className="col-span-12">
                          <Badge variant="outline" className="gap-1 text-amber-700 border-amber-300 bg-amber-50">
                            <AlertTriangle className="h-3 w-3" />
                            Already sourced in {poStatus.poNumber} ({poStatus.status})
                          </Badge>
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            )}
          </div>

          {/* Discount */}
          <DiscountFields
            discountType={discountType}
            discountValue={discountValue}
            subtotal={subtotal}
            onDiscountTypeChange={setDiscountType}
            onDiscountValueChange={setDiscountValue}
          />

          {/* Payment terms */}
          <div className="border rounded-lg p-4 space-y-4">
            <h3 className="font-semibold text-sm">Payment Terms</h3>
            {isHybrid ? (
              <p className="text-sm text-muted-foreground">
                This order uses a hybrid (down payment + installments) plan, which cannot be edited here. Item,
                customer, and delivery changes above are still saved.
              </p>
            ) : (
              <>
                <PaymentTypeSelector
                  value={paymentType}
                  onChange={setPaymentType}
                />
                {paymentType === "installments" && (
                  <InstallmentFields
                    totalAmount={netTotal}
                    installmentMonths={paymentDetails.installmentMonths || 6}
                    paymentStartDate={(paymentDetails as any).paymentStartDate || ""}
                    onInstallmentMonthsChange={(months) => handlePaymentDetailChange("installmentMonths", months)}
                    onPaymentStartDateChange={(date) => handlePaymentDetailChange("paymentStartDate", date)}
                  />
                )}
                {paymentType === "cheque" && (
                  <ChequeFields
                    chequeNumber={paymentDetails.chequeNumber || ""}
                    bankName={paymentDetails.chequeBankName || ""}
                    dueDate={paymentDetails.chequeDueDate || ""}
                    amount={paymentDetails.chequeAmount || netTotal}
                    notes={paymentDetails.chequeNotes || ""}
                    totalAmount={netTotal}
                    onChange={handlePaymentDetailChange}
                  />
                )}
              </>
            )}
          </div>

          <div className="flex flex-wrap justify-end gap-x-6 gap-y-1 text-sm border-t pt-4">
            <div>
              Subtotal: <span className="font-medium">{formatCurrency(subtotal)}</span>
            </div>
            {discountAmount > 0 && (
              <div>
                Discount: <span className="font-medium">-{formatCurrency(discountAmount)}</span>
              </div>
            )}
            <div>
              VAT (14%): <span className="font-medium">{formatCurrency(vatAmount)}</span>
            </div>
            <div>
              Total: <span className="font-semibold">{formatCurrency(netTotal)}</span>
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={saving}>
            {saving ? "Saving..." : "Save Changes"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
