"use client"

import { DialogDescription } from "@/components/ui/dialog"
import { useEffect, useState, useRef } from "react"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Label } from "@/components/ui/label"
import { useI18n } from "@/lib/i18n-context"
import { Printer } from "lucide-react"
import { computeTotals } from "@/lib/print-totals"
import { escapeHtml, renderTotalsBlock, TOTALS_BLOCK_CSS } from "@/lib/print-html"

interface QuotationItem {
  id: number
  product_name: string
  quantity: number
  unit_price: number
  total: number
}

interface QuotationData {
  id: number
  quotation_number: string
  quotation_request_number?: string
  department_name?: string
  receiver_name?: string
  customer_name: string
  customer_phone: string | null
  customer_email: string | null
  validity_days: number
  notes: string | null
  subtotal: number
  tax: number
  total: number
  status: string
  created_at: string
  quotation_date?: string
  items: QuotationItem[]
  payment_terms?: string
  payment_type?: string
  payment_details?: any
  schedule_entries?: any[]
  discount_type?: string
  discount_value?: number
  discount_amount?: number
  net_total?: number
  delivery_date?: string
  delivery_address?: string
}

interface QuotationPreviewDialogProps {
  quotation: QuotationData | null
  open: boolean
  onOpenChange: (open: boolean) => void
}

// Batch 3: subtotal - discount = net subtotal; net x 14% = VAT; net + VAT = total (lib/print-totals.ts). The lines are
// the source of the subtotal; only a quotation with no lines at all falls back to its stored subtotal (without a
// discount, because what the stored subtotal means when a discount exists is not settled). Used by the printout AND
// the on-screen preview so the two always agree.
function quotationTotals(q: QuotationData) {
  const linesSubtotal = (q.items || []).reduce((sum, item) => sum + item.quantity * item.unit_price, 0)
  return linesSubtotal > 0
    ? computeTotals({ subtotal: linesSubtotal, discountType: q.discount_type, discountValue: q.discount_value, discountAmount: q.discount_amount })
    : computeTotals({ subtotal: q.subtotal || 0 })
}

export function QuotationPreviewDialog({ quotation, open, onOpenChange }: QuotationPreviewDialogProps) {
  const { formatDate, formatCurrency } = useI18n()
  const printRef = useRef<HTMLDivElement>(null)

  const [savedQuotation, setSavedQuotation] = useState<QuotationData | null>(null)
  const [quotationDate, setQuotationDate] = useState<string | null>(null)
  const [validUntil, setValidUntil] = useState<Date | null>(null)
  const [includePaymentTerms, setIncludePaymentTerms] = useState(true)

  useEffect(() => {
    if (quotation && open) {
      setSavedQuotation(quotation)
      const dateStr = quotation.quotation_date || quotation.created_at || new Date().toISOString()
      setQuotationDate(dateStr)
      const baseDate = new Date(dateStr)
      const validDays = quotation.validity_days || 30
      const validUntilDate = new Date(baseDate.getTime() + validDays * 24 * 60 * 60 * 1000)
      setValidUntil(validUntilDate)
    }
  }, [quotation, open])

  const activeQuotation = savedQuotation || quotation

  const formatDateAr = (dateStr: string | null | undefined) => {
    if (!dateStr) return "-"
    const date = new Date(dateStr)
    const day = String(date.getDate()).padStart(2, "0")
    const month = String(date.getMonth() + 1).padStart(2, "0")
    const year = date.getFullYear()
    return `${day}/${month}/${year}`
  }

  const getPaymentTypeAr = (type: string | undefined) => {
    switch (type) {
      case "prepaid": return "الدفع مقدماً"
      case "cash": return "نقدي"
      case "installments": return "تقسيط"
      case "hybrid": return "دفعة مقدمة + أقساط"
      case "cheque": return "شيك"
      case "credit": return "آجل"
      default: return type || "الدفع مقدماً"
    }
  }

  const handlePrint = () => {
    if (!activeQuotation) return

  const items = activeQuotation.items || []
  const totals = quotationTotals(activeQuotation)

    const itemsHtml = items.map((item, idx) => {
      const unitPrice = item.unit_price || 0
      const itemTotal = item.total || item.quantity * item.unit_price
      const unitGineh = Math.floor(unitPrice)
      const unitQirsh = Math.round((unitPrice - unitGineh) * 100)
      const totalGineh = Math.floor(itemTotal)
      const totalQirsh = Math.round((itemTotal - totalGineh) * 100)
      return `
        <tr>
          <td class="center">${idx + 1}</td>
          <td>${escapeHtml(item.product_name)}</td>
          <td class="center">${item.quantity}</td>
          <td class="currency-col">${unitGineh.toLocaleString("en-US")}</td>
          <td class="currency-col">${unitQirsh.toString().padStart(2, "0")}</td>
          <td class="currency-col">${totalGineh.toLocaleString("en-US")}</td>
          <td class="currency-col">${totalQirsh.toString().padStart(2, "0")}</td>
        </tr>`
    }).join("")

    let paymentTermsHtml = ""
    if (includePaymentTerms) {
      const payType = getPaymentTypeAr(activeQuotation.payment_details?.paymentType || activeQuotation.payment_type || activeQuotation.payment_terms)

      let paymentDetailsHtml = ""

      if (activeQuotation.payment_details?.paymentType === "installments" && activeQuotation.payment_details?.installmentMonths) {
        paymentDetailsHtml = `
          <div style="margin-top: 8px; padding: 8px; border: 1px solid #000; background: #f9f9f9;">
            <strong>تفاصيل التقسيط:</strong><br/>
            <span>عدد الأشهر: ${activeQuotation.payment_details.installmentMonths}</span><br/>
            <span>القسط الشهري: ${(activeQuotation.payment_details.monthlyAmount || 0).toLocaleString("en-US")} جنيه</span>
            ${activeQuotation.payment_details.installmentStartDate ? `<br/><span>تاريخ أول قسط: ${formatDateAr(activeQuotation.payment_details.installmentStartDate)}</span>` : ""}
          </div>`
      }

      if (activeQuotation.payment_details?.paymentType === "hybrid") {
        paymentDetailsHtml = `
          <div style="margin-top: 8px; padding: 8px; border: 1px solid #000; background: #f9f9f9;">
            <strong>تفاصيل الدفع:</strong><br/>
            <span>الدفعة المقدمة: ${(activeQuotation.payment_details.downPaymentAmount || 0).toLocaleString("en-US")} جنيه</span><br/>
            <span>المبلغ المتبقي: ${(activeQuotation.payment_details.remainingAmount || 0).toLocaleString("en-US")} جنيه</span>
            ${activeQuotation.payment_details.installmentMonths ? `<br/><span>عدد الأقساط: ${activeQuotation.payment_details.installmentMonths} شهر</span><br/><span>القسط الشهري: ${(activeQuotation.payment_details.monthlyAmount || 0).toLocaleString("en-US")} جنيه</span>` : ""}
          </div>`
      }

      if (activeQuotation.payment_details?.paymentType === "cheque") {
        paymentDetailsHtml = `
          <div style="margin-top: 8px; padding: 8px; border: 1px solid #000; background: #f9f9f9;">
            <strong>تفاصيل الشيك:</strong><br/>
            ${activeQuotation.payment_details.chequeNumber ? `<span>رقم الشيك: ${escapeHtml(activeQuotation.payment_details.chequeNumber)}</span><br/>` : ""}
            ${activeQuotation.payment_details.chequeBankName ? `<span>البنك: ${escapeHtml(activeQuotation.payment_details.chequeBankName)}</span><br/>` : ""}
            ${activeQuotation.payment_details.chequeDueDate ? `<span>تاريخ الاستحقاق: ${formatDateAr(activeQuotation.payment_details.chequeDueDate)}</span><br/>` : ""}
            ${activeQuotation.payment_details.chequeAmount ? `<span>المبلغ: ${(activeQuotation.payment_details.chequeAmount).toLocaleString("en-US")} جنيه</span>` : ""}
          </div>`
      }

      let scheduleHtml = ""
      if (activeQuotation.schedule_entries && activeQuotation.schedule_entries.length > 0) {
        const rows = activeQuotation.schedule_entries.map((entry: any, idx: number) => `
          <tr>
            <td class="center">${idx + 1}</td>
            <td>${formatDateAr(entry.dueDate)}</td>
            <td class="currency-col">${(entry.amount || 0).toLocaleString("en-US")} جنيه</td>
            <td>${escapeHtml(entry.note || "-")}</td>
          </tr>`).join("")

        const totalSchedule = activeQuotation.schedule_entries.reduce((sum: number, e: any) => sum + (e.amount || 0), 0)

        scheduleHtml = `
          <div style="margin-top: 10px;">
            <strong>جدول السداد:</strong>
            <table style="width: 100%; border-collapse: collapse; border: 1px solid #000; margin-top: 5px;">
              <thead>
                <tr style="background: #e8e8e8;">
                  <th style="border: 1px solid #000; padding: 4px; width: 8%;">#</th>
                  <th style="border: 1px solid #000; padding: 4px;">تاريخ الاستحقاق</th>
                  <th style="border: 1px solid #000; padding: 4px;">المبلغ</th>
                  <th style="border: 1px solid #000; padding: 4px;">ملاحظات</th>
                </tr>
              </thead>
              <tbody>
                ${rows}
                <tr style="background: #e8e8e8; font-weight: 700;">
                  <td colspan="2" style="border: 1px solid #000; padding: 4px; text-align: left;">الإجمالي</td>
                  <td style="border: 1px solid #000; padding: 4px; text-align: center;">${totalSchedule.toLocaleString("en-US")} جنيه</td>
                  <td style="border: 1px solid #000; padding: 4px;"></td>
                </tr>
              </tbody>
            </table>
          </div>`
      }

      paymentTermsHtml = `
        <div style="margin-top: 10mm; border: 2px solid #000; padding: 10px;">
          <div style="font-size: 14pt; font-weight: 700; margin-bottom: 8px; text-decoration: underline;">شروط الدفع</div>
          <div style="margin-bottom: 8px;"><strong>طريقة الدفع:</strong> ${payType}</div>
          ${paymentDetailsHtml}
          ${scheduleHtml}
        </div>`
    }

    const notesHtml = activeQuotation.notes ? `
      <div style="margin-top: 8mm; border: 1px solid #999; padding: 8px;">
        <strong>ملاحظات إضافية:</strong><br/>
        <span style="font-size: 10pt;">${escapeHtml(activeQuotation.notes)}</span>
      </div>` : ""

    const printWindow = window.open("", "_blank")
    if (!printWindow) return

    printWindow.document.write(`
<!DOCTYPE html>
<html dir="rtl" lang="ar">
<head>
  <meta charset="UTF-8">
  <title>عرض سعر - ${escapeHtml(activeQuotation.quotation_number)}</title>
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
  <div class="doc-title">عرض سعر</div>

  <!-- Quotation Info -->
  <table class="header-table">
    <tr>
      <td style="width: 25%;"><strong>رقم العرض:</strong></td>
      <td style="width: 25%;">${escapeHtml(activeQuotation.quotation_number)}</td>
      <td style="width: 25%;"><strong>التاريخ:</strong></td>
      <td style="width: 25%;">${formatDateAr(quotationDate)}</td>
    </tr>
    ${activeQuotation.quotation_request_number ? `
    <tr>
      <td><strong>رقم طلب التسعير:</strong></td>
      <td colspan="3">${escapeHtml(activeQuotation.quotation_request_number)}</td>
    </tr>` : ""}
    <tr>
      <td><strong>صالح حتى:</strong></td>
      <td>${validUntil ? formatDateAr(validUntil.toISOString()) : "-"}</td>
      <td><strong>مدة الصلاحية:</strong></td>
      <td>${activeQuotation.validity_days || 30} يوم</td>
    </tr>
    <tr>
      <td colspan="4"><strong>السادة:</strong> ${escapeHtml(activeQuotation.customer_name)}</td>
    </tr>
    ${activeQuotation.customer_phone ? `
    <tr>
      <td><strong>الهاتف:</strong></td>
      <td>${escapeHtml(activeQuotation.customer_phone)}</td>
      <td><strong>البريد الإلكتروني:</strong></td>
      <td>${escapeHtml(activeQuotation.customer_email || "-")}</td>
    </tr>` : ""}
    ${activeQuotation.department_name ? `
    <tr>
      <td><strong>القسم:</strong></td>
      <td colspan="3">${escapeHtml(activeQuotation.department_name)}</td>
    </tr>` : ""}
    ${activeQuotation.receiver_name ? `
    <tr>
      <td><strong>المستلم:</strong></td>
      <td colspan="3">${escapeHtml(activeQuotation.receiver_name)}</td>
    </tr>` : ""}
    ${activeQuotation.delivery_address ? `
    <tr>
      <td><strong>عنوان التسليم:</strong></td>
      <td colspan="3">${escapeHtml(activeQuotation.delivery_address)}</td>
    </tr>` : ""}
    ${activeQuotation.delivery_date ? `
    <tr>
      <td><strong>تاريخ التسليم المتوقع:</strong></td>
      <td colspan="3">${formatDateAr(activeQuotation.delivery_date)}</td>
    </tr>` : ""}
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
${renderTotalsBlock(totals, { total: "إجمالي العرض" })}

  ${paymentTermsHtml}

  <!-- General Terms -->
  <div class="terms-section">
    <div style="font-weight: 700; margin-bottom: 5px;">الشروط والأحكام:</div>
    <ul style="padding-right: 20px;">
      <li>هذا العرض صالح لمدة ${activeQuotation.validity_days || 30} يوم من تاريخ الإصدار</li>
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
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-4xl max-h-[90vh] overflow-y-auto">
        {activeQuotation && (
          <div>
            <DialogHeader>
              <DialogTitle>معاينة عرض السعر</DialogTitle>
              <DialogDescription>مراجعة وطباعة عرض السعر</DialogDescription>
            </DialogHeader>

            {/* Action Buttons */}
            <div className="flex items-center gap-4 justify-end mb-4">
              <div className="flex items-center gap-2">
                <Checkbox
                  id="includePayment"
                  checked={includePaymentTerms}
                  onCheckedChange={(checked) => setIncludePaymentTerms(checked as boolean)}
                />
                <Label htmlFor="includePayment" className="text-sm cursor-pointer">
                  تضمين شروط الدفع في الطباعة
                </Label>
              </div>
              <Button onClick={handlePrint} className="gap-2">
                <Printer className="w-4 h-4" />
                طباعة عرض السعر
              </Button>
            </div>

            {/* Preview Content */}
            <div ref={printRef} className="space-y-6 border rounded-lg p-6" dir="rtl">
              {/* Header */}
              <div className="text-center border-b-2 border-black pb-4">
                <div className="flex justify-center mb-3">
                  <img
                    src="/images/image.png"
                    alt="Misr Motors Logo"
                    className="h-20 object-contain"
                    onError={(e) => {
                      const target = e.target as HTMLImageElement
                      target.style.display = "none"
                    }}
                  />
                </div>
                <div className="text-xl font-bold mb-1">شركة مصر للمحركات</div>
                <div className="text-base font-semibold mb-2">Misr Motors Co.</div>
                <div className="text-sm text-gray-700">
                  <div>العنوان: 212 ش السودان - ميدان لبنان - المهندسين - الجيزة</div>
                  <div>تليفون: 02-33039811 | فاكس: 02-33039818</div>
                  <div>البريد الإلكتروني: sales@misrmotors.com</div>
                </div>
                <div className="text-xs text-gray-500 mt-1 pt-1 border-t">
                  بطاقة ضريبية رقم: 2001 | ملف ضريبة: 10-191-343-5 | رقم التسجيل: 455-050-100
                </div>
              </div>

              {/* Title */}
              <h1 className="text-2xl font-bold text-center underline">عرض سعر</h1>

              {/* Quotation Info */}
              <div className="grid grid-cols-2 gap-4 border p-4">
                <div>
                  <span className="text-sm text-gray-500">رقم العرض:</span>
                  <span className="font-semibold mr-2">{activeQuotation.quotation_number}</span>
                </div>
                <div>
                  <span className="text-sm text-gray-500">التاريخ:</span>
                  <span className="font-semibold mr-2">{formatDateAr(quotationDate)}</span>
                </div>
                {activeQuotation.quotation_request_number && (
                  <div>
                    <span className="text-sm text-gray-500">رقم طلب التسعير:</span>
                    <span className="font-semibold mr-2">{activeQuotation.quotation_request_number}</span>
                  </div>
                )}
                <div>
                  <span className="text-sm text-gray-500">صالح حتى:</span>
                  <span className="font-semibold mr-2">{validUntil ? formatDateAr(validUntil.toISOString()) : "-"}</span>
                </div>
                <div className="col-span-2">
                  <span className="text-sm text-gray-500">السادة:</span>
                  <span className="font-semibold mr-2">{activeQuotation.customer_name}</span>
                </div>
                {activeQuotation.customer_phone && (
                  <div>
                    <span className="text-sm text-gray-500">الهاتف:</span>
                    <span className="font-semibold mr-2">{activeQuotation.customer_phone}</span>
                  </div>
                )}
                {activeQuotation.delivery_date && (
                  <div>
                    <span className="text-sm text-gray-500">تاريخ التسليم:</span>
                    <span className="font-semibold mr-2">{formatDateAr(activeQuotation.delivery_date)}</span>
                  </div>
                )}
              </div>

              {/* Items Table */}
              <div>
                <h3 className="font-bold text-sm border-b pb-1 mb-3">البنود</h3>
                <table className="w-full border-collapse border">
                  <thead>
                    <tr className="bg-gray-100">
                      <th className="border px-2 py-2 text-sm w-10">م</th>
                      <th className="border px-2 py-2 text-sm">البيان</th>
                      <th className="border px-2 py-2 text-sm text-center w-16">الكمية</th>
                      <th className="border px-2 py-2 text-sm text-center w-24">سعر الوحدة</th>
                      <th className="border px-2 py-2 text-sm text-center w-24">القيمة</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(activeQuotation.items || []).map((item, idx) => (
                      <tr key={item.id || idx}>
                        <td className="border px-2 py-2 text-sm text-center">{idx + 1}</td>
                        <td className="border px-2 py-2 text-sm">{item.product_name}</td>
                        <td className="border px-2 py-2 text-sm text-center">{item.quantity}</td>
                        <td className="border px-2 py-2 text-sm text-center">{formatCurrency(item.unit_price)}</td>
                        <td className="border px-2 py-2 text-sm text-center">{formatCurrency(item.total)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Totals */}
              <div className="flex justify-start">
  <div className="w-72 space-y-2">
  {(() => {
                    const t = quotationTotals(activeQuotation)
                    return (
                      <>
                        {t.discount > 0 && (
                          <>
                            <div className="flex justify-between text-sm">
                              <span>المجموع قبل الخصم:</span>
                              <span>{formatCurrency(t.subtotal)}</span>
                            </div>
                            <div className="flex justify-between text-sm text-red-600">
                              <span>الخصم:</span>
                              <span>-{formatCurrency(t.discount)}</span>
                            </div>
                          </>
                        )}
                        <div className="flex justify-between text-sm">
                          <span>{t.discount > 0 ? "المجموع بعد الخصم:" : "المجموع الفرعي:"}</span>
                          <span>{formatCurrency(t.netSubtotal)}</span>
                        </div>
                        <div className="flex justify-between text-sm">
                          <span>ضريبة القيمة المضافة (14%):</span>
                          <span>{formatCurrency(t.vat)}</span>
                        </div>
                        <div className="flex justify-between font-bold text-lg border-t pt-2">
                          <span>الإجمالي:</span>
                          <span>{formatCurrency(t.total)}</span>
                        </div>
                      </>
                    )
                  })()}
                </div>
              </div>

              {/* Payment Terms (in preview always shown) */}
              {activeQuotation.payment_type || activeQuotation.payment_details ? (
                <div className="bg-gray-50 p-4 rounded-lg border">
                  <h3 className="font-bold text-sm mb-3">شروط الدفع</h3>
                  <p className="text-sm mb-2">
                    <strong>طريقة الدفع:</strong> {getPaymentTypeAr(activeQuotation.payment_details?.paymentType || activeQuotation.payment_type || activeQuotation.payment_terms)}
                  </p>
                  {activeQuotation.schedule_entries && activeQuotation.schedule_entries.length > 0 && (
                    <div>
                      <p className="text-sm font-medium mb-2">جدول السداد:</p>
                      <table className="w-full text-xs border-collapse">
                        <thead className="bg-gray-100">
                          <tr>
                            <th className="border px-2 py-1">#</th>
                            <th className="border px-2 py-1">تاريخ الاستحقاق</th>
                            <th className="border px-2 py-1">المبلغ</th>
                            <th className="border px-2 py-1">ملاحظات</th>
                          </tr>
                        </thead>
                        <tbody>
                          {activeQuotation.schedule_entries.map((entry: any, idx: number) => (
                            <tr key={idx}>
                              <td className="border px-2 py-1 text-center">{idx + 1}</td>
                              <td className="border px-2 py-1">{formatDateAr(entry.dueDate)}</td>
                              <td className="border px-2 py-1 text-center font-semibold">{formatCurrency(entry.amount)}</td>
                              <td className="border px-2 py-1">{entry.note || "-"}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              ) : null}

              {/* Notes */}
              {activeQuotation.notes && (
                <div className="border-t pt-3">
                  <p className="text-sm font-bold">ملاحظات إضافية:</p>
                  <p className="text-xs text-gray-700">{activeQuotation.notes}</p>
                </div>
              )}

              {/* Terms */}
              <div className="text-xs text-gray-600 space-y-1">
                <p className="font-bold text-sm">الشروط والأحكام:</p>
                <ul className="list-disc pr-5 space-y-1">
                  <li>هذا العرض صالح لمدة {activeQuotation.validity_days || 30} يوم من تاريخ الإصدار</li>
                  <li>الأسعار قابلة للتغيير بعد انتهاء فترة الصلاحية</li>
                  <li>مواعيد التسليم تقديرية وتخضع للتوافر</li>
                  <li>جميع المدفوعات يجب أن تتم وفقاً للجدول المتفق عليه</li>
                </ul>
              </div>

              {/* Signatures */}
              <div className="flex justify-between mt-10 pt-6">
                <div className="w-48 text-center">
                  <div className="border-t border-gray-400 mt-12 pt-2">
                    <p className="text-sm">توقيع العميل</p>
                  </div>
                </div>
                <div className="w-48 text-center">
                  <div className="border-t border-gray-400 mt-12 pt-2">
                    <p className="text-sm">التوقيع المعتمد</p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
