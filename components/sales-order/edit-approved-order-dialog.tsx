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
import { AlertTriangle, Package, Printer, Trash2, UserPlus } from "lucide-react"
import { computeTotals } from "@/lib/print-totals"
import { escapeHtml, renderTotalsBlock, TOTALS_BLOCK_CSS } from "@/lib/print-html"
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
  /** Batch 2: history of this line (set when the item is on a delivery permit) */
  onDeliveryPermit?: boolean
  deliveredQuantity?: number
  returnedQuantity?: number
  /** lowest quantity the order may be edited to: what the customer keeps (delivered - returned) */
  minQuantity?: number
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
      onDeliveryPermit: !!item.onDeliveryPermit,
      deliveredQuantity: item.deliveredQuantity || 0,
      returnedQuantity: item.returnedQuantity || 0,
      minQuantity: item.minQuantity || 0,
    })),
  )
  // An order that already has delivery permits keeps its history: delivered items stay (a returned item is shown,
  // not erased) and the replacement is added as a new line.
  const hasDeliveryHistory = ((order as any).deliveryPermits?.length || 0) > 0

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

  // Validates the form and persists the edits. Returns true on success so callers
  // (Save, and Save & Print) can decide what to do next without duplicating this logic.
  const saveOrder = async (): Promise<boolean> => {
    if (!customerId) {
      alert("Please select a customer")
      return false
    }
    if (items.length === 0) {
      alert("Please add at least one item")
      return false
    }
    const invalidItem = items.find((item) => {
      // a delivered line whose goods were all returned may drop to 0 (it stays on the order as history)
      const minQty = item.onDeliveryPermit ? item.minQuantity || 0 : 1
      if (item.itemType === "stock") return !item.productId || item.quantity < minQty || item.unitPrice < 0
      return !item.productName.trim() || item.quantity < minQty || item.unitPrice < 0
    })
    if (invalidItem) {
      alert(
        invalidItem.onDeliveryPermit && invalidItem.quantity < (invalidItem.minQuantity || 0)
          ? `"${invalidItem.productName}": the customer keeps ${invalidItem.minQuantity} (delivered ${invalidItem.deliveredQuantity}, returned ${invalidItem.returnedQuantity}), so the quantity cannot be lower.`
          : "Please fill in all item details (product, quantity, and price)",
      )
      return false
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
      return true
    } catch (error: any) {
      console.error("[v0] Failed to save order edits:", error)
      alert(`Failed to save changes: ${error.message || "Unknown error"}`)
      return false
    } finally {
      setSaving(false)
    }
  }

  const handleSave = async () => {
    if (await saveOrder()) {
      onSaved()
      onOpenChange(false)
    }
  }

  const getPaymentTypeAr = (type: PaymentType | undefined) => {
    switch (type) {
      case "cash":
        return "نقدي"
      case "installments":
        return "تقسيط"
      case "hybrid":
        return "دفعة مقدمة + أقساط"
      case "cheque":
        return "شيك"
      case "bank_transfer":
        return "تحويل بنكي"
      default:
        return "نقدي"
    }
  }

  const formatDateAr = (dateStr: string | null | undefined) => {
    if (!dateStr) return "-"
    const date = new Date(dateStr)
    if (Number.isNaN(date.getTime())) return "-"
    const day = String(date.getDate()).padStart(2, "0")
    const month = String(date.getMonth() + 1).padStart(2, "0")
    const year = date.getFullYear()
    return `${day}/${month}/${year}`
  }

  // Prints the order using the current in-dialog state (post-edit values), so the
  // printed document always matches what was just saved via handleSaveAndPrint.
  const handlePrint = () => {
    const customer = customers.find((c) => c.id === customerId)

    const printTotals = computeTotals({ subtotal, discountType, discountValue })

    const itemsHtml = items
      .map((item, idx) => {
        const unitPrice = item.unitPrice || 0
        const itemTotal = item.quantity * item.unitPrice
        const unitGineh = Math.floor(unitPrice)
        const unitQirsh = Math.round((unitPrice - unitGineh) * 100)
        const totalGineh = Math.floor(itemTotal)
        const totalQirsh = Math.round((itemTotal - totalGineh) * 100)
        return `
        <tr>
          <td class="center">${idx + 1}</td>
          <td>${escapeHtml(item.productName)}</td>
          <td class="center">${item.quantity}</td>
          <td class="currency-col">${unitGineh.toLocaleString("en-US")}</td>
          <td class="currency-col">${unitQirsh.toString().padStart(2, "0")}</td>
          <td class="currency-col">${totalGineh.toLocaleString("en-US")}</td>
          <td class="currency-col">${totalQirsh.toString().padStart(2, "0")}</td>
        </tr>`
      })
      .join("")

    let paymentDetailsHtml = ""
    if (paymentType === "installments" && paymentDetails.installmentMonths) {
      paymentDetailsHtml = `
          <div style="margin-top: 8px; padding: 8px; border: 1px solid #000; background: #f9f9f9;">
            <strong>تفاصيل التقسيط:</strong><br/>
            <span>عدد الأشهر: ${paymentDetails.installmentMonths}</span><br/>
            <span>القسط الشهري: ${(paymentDetails.monthlyAmount || 0).toLocaleString("en-US")} جنيه</span>
            ${(paymentDetails as any).paymentStartDate ? `<br/><span>تاريخ أول قسط: ${formatDateAr((paymentDetails as any).paymentStartDate)}</span>` : ""}
          </div>`
    }
    if (paymentType === "hybrid") {
      paymentDetailsHtml = `
          <div style="margin-top: 8px; padding: 8px; border: 1px solid #000; background: #f9f9f9;">
            <strong>تفاصيل الدفع:</strong><br/>
            <span>الدفعة المقدمة: ${(paymentDetails.downPaymentAmount || 0).toLocaleString("en-US")} جنيه</span><br/>
            <span>المبلغ المتبقي: ${(paymentDetails.remainingAmount || 0).toLocaleString("en-US")} جنيه</span>
          </div>`
    }
    if (paymentType === "cheque") {
      paymentDetailsHtml = `
          <div style="margin-top: 8px; padding: 8px; border: 1px solid #000; background: #f9f9f9;">
            <strong>تفاصيل الشيك:</strong><br/>
            ${paymentDetails.chequeNumber ? `<span>رقم الشيك: ${escapeHtml(paymentDetails.chequeNumber)}</span><br/>` : ""}
            ${paymentDetails.chequeBankName ? `<span>البنك: ${escapeHtml(paymentDetails.chequeBankName)}</span><br/>` : ""}
            ${paymentDetails.chequeDueDate ? `<span>تاريخ الاستحقاق: ${formatDateAr(paymentDetails.chequeDueDate)}</span><br/>` : ""}
            ${paymentDetails.chequeAmount ? `<span>المبلغ: ${paymentDetails.chequeAmount.toLocaleString("en-US")} جنيه</span>` : ""}
          </div>`
    }

    const paymentTermsHtml = `
      <div style="margin-top: 10mm; border: 2px solid #000; padding: 10px;">
        <div style="font-size: 14pt; font-weight: 700; margin-bottom: 8px; text-decoration: underline;">شروط الدفع</div>
        <div style="margin-bottom: 8px;"><strong>طريقة الدفع:</strong> ${getPaymentTypeAr(paymentType)}</div>
        ${paymentDetailsHtml}
      </div>`

    const notesHtml = notes
      ? `
      <div style="margin-top: 8mm; border: 1px solid #999; padding: 8px;">
        <strong>ملاحظات إضافية:</strong><br/>
        <span style="font-size: 10pt;">${escapeHtml(notes)}</span>
      </div>`
      : ""

    const printWindow = window.open("", "_blank")
    if (!printWindow) return

    printWindow.document.write(`
<!DOCTYPE html>
<html dir="rtl" lang="ar">
<head>
  <meta charset="UTF-8">
  <title>أمر بيع - ${escapeHtml(order.soNumber)}</title>
  <style>
    @import url('https://fonts.googleapis.com/css2?family=Noto+Naskh+Arabic:wght@400;500;600;700&display=swap');
    * { margin: 0; padding: 0; box-sizing: border-box; }
    @page { size: A4; margin: 15mm; }
    body {
      font-family: 'Noto Naskh Arabic', 'Arial', sans-serif;
      font-size: 12pt;
      line-height: 1.4;
      color: #000;
      background: white;
      direction: rtl;
    }
    table { width: 100%; border-collapse: collapse; border: 2px solid #000; }
    th, td { border: 1px solid #000; padding: 8px; text-align: right; }
    th { background: #e8e8e8; font-weight: 700; }
    .company-header {
      text-align: center;
      border-bottom: 2px solid #000;
      padding: 10px;
      margin-bottom: 5mm;
      display: flex;
      flex-direction: column;
      align-items: center;
    }
    .company-logo { width: 80px; height: 80px; object-fit: contain; margin-bottom: 10px; }
    .company-name-ar { font-size: 18pt; font-weight: 700; margin-bottom: 3px; }
    .company-name-en { font-size: 14pt; font-weight: 600; margin-bottom: 8px; }
    .company-details { font-size: 10pt; line-height: 1.6; }
    .tax-info { font-size: 9pt; margin-top: 5px; border-top: 1px solid #ccc; padding-top: 5px; }
    .doc-title { text-align: center; font-size: 20pt; font-weight: 700; margin: 10mm 0; text-decoration: underline; }
    .header-table { width: 100%; border: 2px solid #000; margin-bottom: 10mm; }
    .header-table td { border: 1px solid #000; padding: 4px 8px; }
    .items-table { width: 100%; border: 2px solid #000; margin-bottom: 10mm; }
    .items-table th { background: #e8e8e8; font-weight: 700; text-align: center; padding: 8px 4px; }
    .items-table td { text-align: right; padding: 6px 4px; }
    .items-table .center { text-align: center; }
    .currency-col { text-align: center; }
    .subheader { font-size: 10pt; font-weight: 600; }
    .signatures { display: grid; grid-template-columns: repeat(2, 1fr); gap: 20mm; margin-top: 15mm; }
    .signature-box { text-align: center; }
    .signature-label { font-weight: 700; margin-bottom: 20mm; text-decoration: underline; }
    .signature-line { border-top: 1px solid #000; margin-top: 15mm; }
    @media print { body { margin: 0; padding: 0; } }${TOTALS_BLOCK_CSS}
  </style>
</head>
<body>
  <!-- Company Header -->
  <div class="company-header">
    <img src="/images/image.png" alt="Misr Motors Logo" class="company-logo" onerror="this.style.display='none'" />
    <div class="company-name-ar">شركة مصر للمحركات</div>
    <div class="company-name-en">Misr Motors Co.</div>
    <div class="company-details">
      <div>العنوان: 212 ش السودان - ميدان لبنان - المهندسين - الجيزة</div>
      <div>تليفون: 02-33039811 | فاكس: 02-33039818</div>
      <div>البريد الإلكتروني: sales@misrmotors.com</div>
    </div>
    <div class="tax-info">بطاقة ضريبية رقم: 2001 | ملف ضريبة: 10-191-343-5 | رقم التسجيل: 455-050-100</div>
  </div>

  <!-- Title -->
  <div class="doc-title">أمر بيع</div>

  <!-- Order Info -->
  <table class="header-table">
    <tr>
      <td style="width: 25%;"><strong>رقم أمر البيع:</strong></td>
      <td style="width: 25%;">${escapeHtml(order.soNumber)}</td>
      <td style="width: 25%;"><strong>التاريخ:</strong></td>
      <td style="width: 25%;">${formatDateAr(order.orderDate)}</td>
    </tr>
    <tr>
      <td colspan="4"><strong>السادة:</strong> ${escapeHtml(customer?.name || "-")}</td>
    </tr>
    ${
      customer?.phone
        ? `
    <tr>
      <td><strong>الهاتف:</strong></td>
      <td>${escapeHtml(customer.phone)}</td>
      <td><strong>البريد الإلكتروني:</strong></td>
      <td>${escapeHtml(customer.email || "-")}</td>
    </tr>`
        : ""
    }
    ${
      deliveryAddress
        ? `
    <tr>
      <td><strong>عنوان التسليم:</strong></td>
      <td colspan="3">${escapeHtml(deliveryAddress)}</td>
    </tr>`
        : ""
    }
    ${
      deliveryContactName
        ? `
    <tr>
      <td><strong>مسؤول الاستلام:</strong></td>
      <td>${escapeHtml(deliveryContactName)}</td>
      <td><strong>هاتف الاستلام:</strong></td>
      <td>${escapeHtml(deliveryContactPhone || "-")}</td>
    </tr>`
        : ""
    }
  </table>

  <!-- Items Table -->
  <table class="items-table">
    <thead>
      <tr>
        <th rowspan="2" style="width: 6%;">م</th>
        <th rowspan="2" style="width: 36%;">البيان</th>
        <th rowspan="2" style="width: 8%;">الكمية</th>
        <th colspan="2" style="text-align: center;">سعر الوحدة</th>
        <th colspan="2" style="text-align: center;">القيمة</th>
      </tr>
      <tr>
        <th class="subheader" style="width: 12.5%;">جنيه</th>
        <th class="subheader" style="width: 12.5%;">قرش</th>
        <th class="subheader" style="width: 12.5%;">جنيه</th>
        <th class="subheader" style="width: 12.5%;">قرش</th>
      </tr>
    </thead>
    <tbody>
      ${itemsHtml}
    </tbody>
  </table>
${renderTotalsBlock(printTotals)}

  ${isHybrid ? "" : paymentTermsHtml}

  ${notesHtml}

  <!-- Signatures -->
  <div class="signatures">
    <div class="signature-box">
      <div class="signature-label">توقيع العميل</div>
      <div class="signature-line"></div>
    </div>
    <div class="signature-box">
      <div class="signature-label">التوقيع المعتمد</div>
      <div class="signature-line"></div>
    </div>
  </div>
</body>
</html>`)
    printWindow.document.close()
    printWindow.print()
  }

  const handleSaveAndPrint = async () => {
    if (await saveOrder()) {
      handlePrint()
      onSaved()
      onOpenChange(false)
    }
  }

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-4xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Edit Sales Order: {order.soNumber}</DialogTitle>
          <DialogDescription>
            This order is already approved. Changes save immediately and the order stays approved.
            {hasDeliveryHistory &&
              " Delivery has started: delivered items stay on the order as history. To exchange returned goods, lower that line to what the customer keeps and add the replacement item as a new line."}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6 py-2">
          {/* Customer & delivery info */}
          <div className="border rounded-lg p-4 space-y-4">
            <h3 className="font-semibold text-sm">Customer &amp; Delivery</h3>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>{t("field.customer")}</Label>
                <Select value={customerId} onValueChange={setCustomerId} disabled={hasDeliveryHistory}>
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
                      {item.itemType === "stock" && item.onDeliveryPermit ? (
                        <div className="col-span-4 space-y-1">
                          <Label className="text-xs">Product</Label>
                          <div className="text-sm font-medium pt-2">{item.productName}</div>
                        </div>
                      ) : item.itemType === "stock" ? (
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
                              disabled={item.onDeliveryPermit}
                              onChange={(e) => updateItem(item.key, { productName: e.target.value })}
                            />
                          </div>
                          <div className="col-span-2 space-y-1">
                            <Label className="text-xs">Supplier</Label>
                            <Select
                              value={item.supplierName || ""}
                              disabled={item.onDeliveryPermit}
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
                          min={item.onDeliveryPermit ? item.minQuantity || 0 : 1}
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
                        <Button
                          variant="destructive"
                          size="icon"
                          onClick={() => removeItem(item)}
                          disabled={item.onDeliveryPermit}
                          title={item.onDeliveryPermit ? "On a delivery permit - it stays on the order as history" : undefined}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                      {item.onDeliveryPermit && (
                        <div className="col-span-12">
                          <Badge variant="outline" className="gap-1 text-blue-700 border-blue-300 bg-blue-50">
                            Delivered {item.deliveredQuantity || 0} · Returned {item.returnedQuantity || 0} · Customer keeps{" "}
                            {item.minQuantity || 0}
                          </Badge>
                        </div>
                      )}
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
          <Button variant="outline" onClick={handleSaveAndPrint} disabled={saving} className="gap-2">
            <Printer className="h-4 w-4" />
            {saving ? "Saving..." : "Save & Print"}
          </Button>
          <Button onClick={handleSave} disabled={saving}>
            {saving ? "Saving..." : "Save Changes"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
