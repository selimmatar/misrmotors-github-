"use client"

import { useMemo, useState } from "react"
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
import { Loader2, Package, Trash2, UserPlus, Upload } from "lucide-react"
import { useAppContext } from "@/lib/app-context"
import { ProductSearchCombobox } from "@/components/product-search-combobox"
import { DiscountFields, calculateDiscount, type DiscountType } from "@/components/discount"
import { PaymentTypeSelector, InstallmentFields, ChequeFields } from "@/components/payment"
import type { PaymentType, PaymentDetails, ItemCategory } from "@/lib/types"

interface QuotationItemInput {
  id?: number
  item_type?: string
  product_id?: number | null
  product_name: string
  quantity: number
  unit_price: number
  supplier_name?: string | null
}

interface QuotationInput {
  id: number
  quotation_number: string
  customer_id?: number | null
  customer_name: string
  customer_phone?: string | null
  customer_email?: string | null
  notes?: string | null
  delivery_address?: string | null
  delivery_contact_name?: string | null
  delivery_contact_phone?: string | null
  discount_type?: string | null
  discount_value?: number | null
  discount_amount?: number | null
  payment_type?: string | null
  payment_details?: any
  so_type?: string | null
  items?: QuotationItemInput[]
}

interface EditItem {
  key: string
  id?: number
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

interface ApproveConvertQuotationDialogProps {
  quotation: QuotationInput
  onOpenChange: (open: boolean) => void
  onApproved: (soNumber: string) => void
}

let rowKeyCounter = 0
function nextRowKey() {
  rowKeyCounter += 1
  return `approve-row-${Date.now()}-${rowKeyCounter}`
}

const formatCurrency = (amount: number) => `${(amount || 0).toFixed(2)} EGP`

export function ApproveConvertQuotationDialog({ quotation, onOpenChange, onApproved }: ApproveConvertQuotationDialogProps) {
  const { customers, products, suppliers, inventory } = useAppContext()

  const [customerId, setCustomerId] = useState(quotation.customer_id ? String(quotation.customer_id) : "")
  const [deliveryAddress, setDeliveryAddress] = useState(quotation.delivery_address || "")
  const [deliveryContactName, setDeliveryContactName] = useState(quotation.delivery_contact_name || "")
  const [deliveryContactPhone, setDeliveryContactPhone] = useState(quotation.delivery_contact_phone || "")
  const [notes, setNotes] = useState(quotation.notes || "")

  const [items, setItems] = useState<EditItem[]>(() =>
    (quotation.items || []).map((item) => ({
      key: nextRowKey(),
      id: item.id,
      itemType: item.item_type === "outsourced" ? "outsourced" : "stock",
      itemCategory: (quotation.so_type === "MAINTENANCE_PARTS" ? "MAINTENANCE_PARTS" : "EQUIPMENT") as ItemCategory,
      productId: item.product_id ? String(item.product_id) : "",
      productName: item.product_name || "",
      outsourcedUnit: "unit",
      supplierId: suppliers.find((s) => s.name === item.supplier_name)?.id || "",
      supplierName: item.supplier_name || "",
      quantity: item.quantity || 0,
      unitPrice: item.unit_price || 0,
    })),
  )

  const [discountType, setDiscountType] = useState<DiscountType>((quotation.discount_type as DiscountType) || "none")
  const [discountValue, setDiscountValue] = useState<number>(quotation.discount_value || 0)

  const isHybrid = quotation.payment_type === "hybrid"
  const [paymentType, setPaymentType] = useState<PaymentType>((quotation.payment_type as PaymentType) || "cash")
  const [paymentDetails, setPaymentDetails] = useState<PaymentDetails>(
    quotation.payment_details || {
      paymentType: (quotation.payment_type as PaymentType) || "cash",
      installmentMonths: 6,
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
    },
  )

  const handlePaymentDetailChange = (field: string, value: string | number) => {
    setPaymentDetails((prev) => ({ ...prev, [field]: value }))
  }

  const [approvalDocument, setApprovalDocument] = useState<File | null>(null)
  const [saving, setSaving] = useState(false)
  const [uploadingDocument, setUploadingDocument] = useState(false)

  const aggregatedInventory = useMemo(() => {
    const totals = new Map<string, number>()
    for (const inv of inventory) {
      if ((inv as any).isReturned) continue
      totals.set(inv.productId, (totals.get(inv.productId) || 0) + (inv.quantity || 0))
    }
    return Array.from(totals.entries()).map(([productId, quantity]) => ({ productId, quantity }))
  }, [inventory])

  const getAvailableStock = (productId: string): number | null => {
    if (!productId) return null
    const entry = aggregatedInventory.find((inv) => inv.productId === productId)
    return entry ? entry.quantity : 0
  }

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

  const removeItem = (key: string) => {
    setItems((prev) => prev.filter((item) => item.key !== key))
  }

  const handleSelectStockProduct = (key: string, productId: string) => {
    const product = products.find((p) => p.id === productId)
    updateItem(key, {
      productId,
      productName: product?.productName || "",
      unitPrice: product?.unitPrice || 0,
    })
  }

  // Matches the 14% VAT applied everywhere else in the app.
  const VAT_RATE = 0.14
  const subtotal = items.reduce((sum, item) => sum + item.quantity * item.unitPrice, 0)
  const { discountAmount, netTotal: subtotalAfterDiscount } = calculateDiscount(subtotal, discountType, discountValue)
  const vatAmount = subtotalAfterDiscount * VAT_RATE
  const netTotal = subtotalAfterDiscount + vatAmount

  const handleApproveAndConvert = async () => {
    if (!approvalDocument) {
      alert("Please upload an approval document before approving")
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

    setSaving(true)
    setUploadingDocument(true)
    try {
      const formData = new FormData()
      formData.append("file", approvalDocument)
      formData.append("quotation_id", String(quotation.id))
      formData.append("document_type", "approval")

      const uploadResponse = await fetch("/api/documents/upload", {
        method: "POST",
        body: formData,
      })

      let documentUrl = ""
      if (uploadResponse.ok) {
        const uploadResult = await uploadResponse.json()
        documentUrl = uploadResult.url || ""
      }
      setUploadingDocument(false)

      const payloadItems = items.map((item) => ({
        id: item.id,
        product_id: item.itemType === "stock" ? item.productId || null : null,
        product_name: item.productName,
        quantity: item.quantity,
        unit_price: item.unitPrice,
        total: item.quantity * item.unitPrice,
        item_type: item.itemType,
        item_category: item.itemCategory,
        outsourced_unit: item.outsourcedUnit,
        supplier_id: item.itemType === "outsourced" ? item.supplierId || null : null,
        supplier_name: item.itemType === "outsourced" ? item.supplierName : null,
      }))

      const response = await fetch("/api/sales-quotations/approve", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          quotation_id: quotation.id,
          approval_document_url: documentUrl,
          customer_id: customerId ? Number(customerId) : null,
          delivery_address: deliveryAddress,
          delivery_contact_name: deliveryContactName,
          delivery_contact_phone: deliveryContactPhone,
          notes,
          discount_type: discountType,
          discount_value: discountValue,
          discount_amount: discountAmount,
          subtotal: subtotalAfterDiscount,
          tax: vatAmount,
          total: netTotal,
          net_total: netTotal,
          payment_type: paymentType,
          payment_details: isHybrid ? quotation.payment_details : paymentDetails,
          items: payloadItems,
        }),
      })

      if (!response.ok) {
        const error = await response.json()
        throw new Error(error.error || "Failed to approve quotation")
      }

      const { sales_order } = await response.json()
      onApproved(sales_order.so_number)
    } catch (error) {
      console.error("Error approving quotation:", error)
      alert(error instanceof Error ? error.message : "Failed to approve quotation")
    } finally {
      setSaving(false)
      setUploadingDocument(false)
    }
  }

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Approve &amp; Convert to Sales Order: {quotation.quotation_number}</DialogTitle>
          <DialogDescription>
            Review and adjust the quotation before converting it into a sales order &mdash; useful when the customer
            only approved some of the requested items.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6 py-2">
          {/* Customer & delivery info */}
          <div className="border rounded-lg p-4 space-y-4">
            <h3 className="font-semibold text-sm">Customer &amp; Delivery</h3>
            <p className="text-xs text-muted-foreground">
              Quoted to: {quotation.customer_name}
              {quotation.customer_phone ? ` • ${quotation.customer_phone}` : ""}
              {quotation.customer_email ? ` • ${quotation.customer_email}` : ""}
            </p>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Customer</Label>
                <Select value={customerId} onValueChange={setCustomerId}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select customer" />
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
              <p className="text-sm text-muted-foreground text-center py-6">
                No items. Remove the whole quotation with Reject instead, or add an item above.
              </p>
            ) : (
              <div className="space-y-3">
                {items.map((item) => {
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
                              <SelectTrigger>
                                <SelectValue placeholder="Select supplier" />
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
                      <div className="col-span-1 space-y-1">
                        <Label className="text-xs">Total</Label>
                        <div className="text-sm font-medium pt-2">{formatCurrency(item.quantity * item.unitPrice)}</div>
                      </div>
                      <div className="col-span-1 flex justify-end">
                        <Button variant="destructive" size="icon" onClick={() => removeItem(item.key)}>
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
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
                This quotation uses a hybrid (down payment + installments) plan, which cannot be edited here. Item,
                customer, and delivery changes above are still applied to the sales order.
              </p>
            ) : (
              <>
                <PaymentTypeSelector value={paymentType} onChange={setPaymentType} />
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

          {/* Approval document */}
          <div className="border rounded-lg p-4 space-y-2">
            <Label htmlFor="approval-document">Approval Document *</Label>
            <Input
              id="approval-document"
              type="file"
              accept=".pdf,.jpg,.jpeg,.png,.doc,.docx"
              onChange={(e) => {
                const file = e.target.files?.[0]
                if (file) setApprovalDocument(file)
              }}
            />
            {approvalDocument && <p className="text-sm text-muted-foreground">Selected: {approvalDocument.name}</p>}
            <p className="text-xs text-muted-foreground">
              Upload the signed quotation or authorization letter confirming what the customer approved.
            </p>
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
          <Button onClick={handleApproveAndConvert} disabled={saving || !approvalDocument}>
            {saving ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin mr-2" />
                {uploadingDocument ? "Uploading..." : "Approving..."}
              </>
            ) : (
              <>
                <Upload className="w-4 h-4 mr-2" />
                Approve &amp; Convert to SO
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
