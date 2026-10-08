"use client"

import { useMemo, useRef, useState } from "react"
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
import { Loader2, Package, Printer, Trash2, UserPlus, Upload } from "lucide-react"
import { useAppContext } from "@/lib/app-context"
import { ProductSearchCombobox } from "@/components/product-search-combobox"
import { DiscountFields, calculateDiscount, type DiscountType } from "@/components/discount"
import { PaymentTypeSelector, InstallmentFields, ChequeFields } from "@/components/payment"
import type { PaymentType, PaymentDetails, ItemCategory } from "@/lib/types"
import { normalizeQuotationPaymentDetails } from "@/lib/payment-type"

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
  quotation_request_number?: string | null
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
  validity_days?: number | null
  quotation_date?: string | null
  created_at?: string | null
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
  // Called after the quotation was saved successfully (so the parent can refresh its list).
  onSaved?: () => void
}

let rowKeyCounter = 0
function nextRowKey() {
  rowKeyCounter += 1
  return `approve-row-${Date.now()}-${rowKeyCounter}`
}

const formatCurrency = (amount: number) => `${(amount || 0).toFixed(2)} EGP`

export function ApproveConvertQuotationDialog({ quotation, onOpenChange, onApproved, onSaved }: ApproveConvertQuotationDialogProps) {
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
  const [printing, setPrinting] = useState(false)
  const [uploadingDocument, setUploadingDocument] = useState(false)
  const approveInFlight = useRef(false)

  // Approve & Convert uses the values stored on the quotation, so any edit made in this
  // dialog has to be saved first. The signature below describes everything the user can
  // edit; the form is "dirty" while it differs from the last saved (or initially loaded) state.
  const currentSignature = JSON.stringify({
    customerId,
    deliveryAddress,
    deliveryContactName,
    deliveryContactPhone,
    notes,
    items: items.map(({ key: _key, ...rest }) => rest),
    discountType,
    discountValue,
    paymentType,
    paymentDetails,
  })
  const [savedSignature, setSavedSignature] = useState(() => currentSignature)
  const hasUnsavedChanges = currentSignature !== savedSignature

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

  const formatDateAr = (dateStr: string | null | undefined) => {
    if (!dateStr) return "-"
    const date = new Date(dateStr)
    if (Number.isNaN(date.getTime())) return "-"
    const day = String(date.getDate()).padStart(2, "0")
    const month = String(date.getMonth() + 1).padStart(2, "0")
    const year = date.getFullYear()
    return `${day}/${month}/${year}`
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

  // Prints the quotation using the current in-dialog (post-edit) state, so the customer
  // can be shown the updated terms before the quotation is actually converted to an SO.
  // Saves the current in-dialog edits back to the quotation (without approving or
  // converting it) and then opens the print-ready copy, so the printed document always
  // matches what's stored.
  const handleSaveAndPrintQuotation = async () => {
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

    const customer = customers.find((c) => c.id === customerId)
    const customerName = customer?.name || quotation.customer_name
    const customerPhone = customer?.phone || quotation.customer_phone
    const customerEmail = customer?.email || quotation.customer_email

    const signatureAtSave = currentSignature
    setPrinting(true)
    try {
      const payloadItems = items.map((item) => ({
        product_id: item.itemType === "stock" ? item.productId || null : null,
        product_name: item.productName,
        quantity: item.quantity,
        unit_price: item.unitPrice,
        item_type: item.itemType === "stock" ? "inventory" : "outsourced",
        supplier_name: item.itemType === "outsourced" ? item.supplierName : null,
      }))

      const saveResponse = await fetch("/api/sales-quotations", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          quotation_id: quotation.id,
          customer_id: customerId ? Number(customerId) : null,
          customer_name: customerName,
          customer_phone: customerPhone,
          customer_email: customerEmail,
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
          payment_details: isHybrid
            ? quotation.payment_details
            : normalizeQuotationPaymentDetails(paymentType, paymentDetails),
          items: payloadItems,
        }),
      })

      if (!saveResponse.ok) {
        const error = await saveResponse.json()
        throw new Error(error.error || "Failed to save quotation changes")
      }

      // Confirm what was stored: re-read the quotation and compare the item count with what was sent,
      // so a save that silently lost lines is reported instead of looking successful.
      const verifyResponse = await fetch(`/api/sales-quotations?id=${quotation.id}`)
      if (!verifyResponse.ok) {
        throw new Error("The quotation was saved but could not be re-read to verify it. Please reopen it and check the items.")
      }
      const verifyData = await verifyResponse.json()
      const storedItemCount = (verifyData.quotation?.items || []).length
      if (storedItemCount !== payloadItems.length) {
        throw new Error(
          `Saved items do not match: sent ${payloadItems.length} item(s) but ${storedItemCount} are stored. Please reopen the quotation and check it.`,
        )
      }
      setSavedSignature(signatureAtSave)
      onSaved?.()

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
          <td>${item.productName}</td>
          <td class="center">${item.quantity}</td>
          <td class="currency-col">${unitGineh.toLocaleString("en-US")}</td>
          <td class="currency-col">${unitQirsh.toString().padStart(2, "0")}</td>
          <td class="currency-col">${totalGineh.toLocaleString("en-US")}</td>
          <td class="currency-col">${totalQirsh.toString().padStart(2, "0")}</td>
        </tr>`
      })
      .join("")

    const discountHtml =
      discountAmount > 0
        ? `
      <tr>
        <td colspan="5" style="text-align: left; color: red;">الخصم</td>
        <td class="currency-col" style="color: red;">-${Math.floor(discountAmount).toLocaleString("en-US")}</td>
        <td class="currency-col" style="color: red;">${Math.round((discountAmount - Math.floor(discountAmount)) * 100)
          .toString()
          .padStart(2, "0")}</td>
      </tr>`
        : ""

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
            ${paymentDetails.chequeNumber ? `<span>رقم الشيك: ${paymentDetails.chequeNumber}</span><br/>` : ""}
            ${paymentDetails.chequeBankName ? `<span>البنك: ${paymentDetails.chequeBankName}</span><br/>` : ""}
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
        <span style="font-size: 10pt;">${notes}</span>
      </div>`
      : ""

    const quotationDateStr = quotation.quotation_date || quotation.created_at || new Date().toISOString()
    const validityDays = quotation.validity_days || 30
    const validUntil = new Date(new Date(quotationDateStr).getTime() + validityDays * 24 * 60 * 60 * 1000)

    const printWindow = window.open("", "_blank")
    if (!printWindow) return

    printWindow.document.write(`
<!DOCTYPE html>
<html dir="rtl" lang="ar">
<head>
  <meta charset="UTF-8">
  <title>عرض سعر - ${quotation.quotation_number}</title>
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
    .terms-section { margin-top: 8mm; font-size: 10pt; }
    .terms-section li { margin-bottom: 3px; }
    @media print { body { margin: 0; padding: 0; } }
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
  <div class="doc-title">عرض سعر</div>

  <!-- Quotation Info -->
  <table class="header-table">
    <tr>
      <td style="width: 25%;"><strong>رقم العرض:</strong></td>
      <td style="width: 25%;">${quotation.quotation_number}</td>
      <td style="width: 25%;"><strong>التاريخ:</strong></td>
      <td style="width: 25%;">${formatDateAr(quotationDateStr)}</td>
    </tr>
    ${
      quotation.quotation_request_number
        ? `
    <tr>
      <td><strong>رقم طلب التسعير:</strong></td>
      <td colspan="3">${quotation.quotation_request_number}</td>
    </tr>`
        : ""
    }
    <tr>
      <td><strong>صالح حتى:</strong></td>
      <td>${formatDateAr(validUntil.toISOString())}</td>
      <td><strong>مدة الصلاحية:</strong></td>
      <td>${validityDays} يوم</td>
    </tr>
    <tr>
      <td colspan="4"><strong>السادة:</strong> ${customerName}</td>
    </tr>
    ${
      customerPhone
        ? `
    <tr>
      <td><strong>الهاتف:</strong></td>
      <td>${customerPhone}</td>
      <td><strong>البريد الإلكتروني:</strong></td>
      <td>${customerEmail || "-"}</td>
    </tr>`
        : ""
    }
    ${
      deliveryAddress
        ? `
    <tr>
      <td><strong>عنوان التسليم:</strong></td>
      <td colspan="3">${deliveryAddress}</td>
    </tr>`
        : ""
    }
    ${
      deliveryContactName
        ? `
    <tr>
      <td><strong>مسؤول الاستلام:</strong></td>
      <td>${deliveryContactName}</td>
      <td><strong>هاتف الاستلام:</strong></td>
      <td>${deliveryContactPhone || "-"}</td>
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
    <tfoot>
      ${discountHtml}
      <tr>
        <td colspan="5" style="text-align: left;">المجموع الفرعي</td>
        <td class="currency-col">${Math.floor(subtotalAfterDiscount).toLocaleString("en-US")}</td>
        <td class="currency-col">${Math.round((subtotalAfterDiscount - Math.floor(subtotalAfterDiscount)) * 100)
          .toString()
          .padStart(2, "0")}</td>
      </tr>
      <tr>
        <td colspan="5" style="text-align: left;">ضريبة القيمة المضافة (14%)</td>
        <td class="currency-col">${Math.floor(vatAmount).toLocaleString("en-US")}</td>
        <td class="currency-col">${Math.round((vatAmount - Math.floor(vatAmount)) * 100)
          .toString()
          .padStart(2, "0")}</td>
      </tr>
      <tr>
        <td colspan="5" style="text-align: left; font-weight: 700;">إجمالي العرض</td>
        <td class="currency-col" style="font-weight: 700;">${Math.floor(netTotal).toLocaleString("en-US")}</td>
        <td class="currency-col" style="font-weight: 700;">${Math.round((netTotal - Math.floor(netTotal)) * 100)
          .toString()
          .padStart(2, "0")}</td>
      </tr>
    </tfoot>
  </table>

  ${isHybrid ? "" : paymentTermsHtml}

  <!-- General Terms -->
  <div class="terms-section">
    <div style="font-weight: 700; margin-bottom: 5px;">الشروط والأحكام:</div>
    <ul style="padding-right: 20px;">
      <li>هذا العرض صالح لمدة ${validityDays} يوم من تاريخ الإصدار</li>
      <li>الأسعار قابلة للتغيير بعد انتهاء فترة الصلاحية</li>
      <li>مواعيد التسليم تقديرية وتخضع للتوافر</li>
      <li>جميع المدفوعات يجب أن تتم وفقاً للجدول المتفق عليه</li>
    </ul>
  </div>

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
    } catch (error) {
      console.error("Error saving quotation before printing:", error)
      alert(error instanceof Error ? error.message : "Failed to save quotation changes")
    } finally {
      setPrinting(false)
    }
  }

  const handleApproveAndConvert = async () => {
    if (approveInFlight.current) return
    if (hasUnsavedChanges) {
      alert("You have unsaved changes. Please use \"Save & Print QT\" to save them before approving.")
      return
    }
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

    approveInFlight.current = true
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

      // The server converts the stored quotation; only the quotation id and the approval document are sent.
      const response = await fetch("/api/sales-quotations/approve", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          quotation_id: quotation.id,
          approval_document_url: documentUrl,
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
      approveInFlight.current = false
      setSaving(false)
      setUploadingDocument(false)
    }
  }

  return (
    <Dialog open onOpenChange={onOpenChange}>
        <DialogContent className="sm:max-w-4xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Approve &amp; Convert to Sales Order: {quotation.quotation_number}</DialogTitle>
          <DialogDescription>
            Review and adjust the quotation before converting it into a sales order &mdash; useful when the customer
            only approved some of the requested items. Changes must be saved (&ldquo;Save &amp; Print QT&rdquo;) before the quotation can be approved.
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
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving || printing}>
            Cancel
          </Button>
          <Button
            variant="outline"
            onClick={handleSaveAndPrintQuotation}
            disabled={saving || printing}
            className="gap-2"
          >
            {printing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Printer className="h-4 w-4" />}
            Save &amp; Print QT
          </Button>
          {hasUnsavedChanges && (
            <span className="self-center text-sm text-amber-600 mr-auto">Save changes before approving</span>
          )}
          <Button onClick={handleApproveAndConvert} disabled={saving || printing || !approvalDocument || hasUnsavedChanges}>
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
