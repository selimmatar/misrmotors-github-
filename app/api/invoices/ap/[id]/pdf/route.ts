import { type NextRequest, NextResponse } from "next/server"
import { createAdminClient } from "@/lib/supabase/admin"
import { COMPANY_SETTINGS, getTaxInfo } from "@/lib/company-settings"

export const dynamic = "force-dynamic"

// Numbers formatter - returns English (Western) numerals to avoid calculation issues
function toArabicNumbers(num: number | string): string {
  return String(num)
}

// Format date in Arabic
function formatArabicDate(dateStr: string): string {
  if (!dateStr) return "-"
  const date = new Date(dateStr)
  const day = toArabicNumbers(date.getDate())
  const month = toArabicNumbers(date.getMonth() + 1)
  const year = toArabicNumbers(date.getFullYear())
  return `${day}/${month}/${year}`
}

// Format currency in Arabic
function formatArabicCurrency(amount: number): string {
  return `${toArabicNumbers(amount.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }))} ج.م`
}

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const invoiceId = Number.parseInt(id)

    if (!invoiceId || isNaN(invoiceId)) {
      return NextResponse.json({ error: "Invalid invoice ID" }, { status: 400 })
    }

    const supabase = createAdminClient()

    // Fetch AP invoice with related data
    const { data: invoice, error: invoiceError } = await supabase
      .from("accounts_payable")
      .select(`
        *,
        suppliers:supplier_id (supplier_name, phone, address, city),
        purchase_orders:po_id (
          po_number,
          order_date,
          total,
          payment_type,
          payment_terms,
          purchase_order_items (
            quantity,
            unit_price,
            total,
            item_type,
            outsourced_name,
            item_name_snapshot,
            products:product_id (product_name, sku)
          )
        )
      `)
      .eq("invoice_id", invoiceId)
      .single()

    if (invoiceError || !invoice) {
      console.error("AP Invoice PDF - Invoice not found:", invoiceId, invoiceError)
      return new NextResponse(generateErrorHtml("فاتورة المورد غير موجودة", `Invoice ID: ${id}`), {
        status: 404,
        headers: { "Content-Type": "text/html; charset=utf-8" },
      })
    }

    const items = invoice.purchase_orders?.purchase_order_items || []
    const supplier = invoice.suppliers || {}
    const po = invoice.purchase_orders || {}

    const paymentType = invoice.payment_type || "cash"

    // Generate HTML invoice
    const html = `
<!DOCTYPE html>
<html dir="rtl" lang="ar">
<head>
  <meta charset="UTF-8">
  <title>فاتورة مورد - ${invoice.invoice_number}</title>
  <style>
    @import url('https://fonts.googleapis.com/css2?family=Noto+Naskh+Arabic:wght@400;500;600;700&display=swap');
    
    * { margin: 0; padding: 0; box-sizing: border-box; }
    
    body {
      font-family: 'Noto Naskh Arabic', 'Arial', sans-serif;
      font-size: 14px;
      line-height: 1.6;
      color: #1a1a1a;
      background: white;
      padding: 20mm;
      direction: rtl;
    }
    
    .invoice-container {
      max-width: 210mm;
      margin: 0 auto;
      border: 2px solid #dc2626;
      padding: 15mm;
    }
    
    .header {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      border-bottom: 3px solid #dc2626;
      padding-bottom: 15px;
      margin-bottom: 20px;
    }
    
    .company-header { text-align: right; }
    .company-name-ar { font-size: 24px; font-weight: 700; color: #dc2626; margin-bottom: 5px; }
    .company-name-en { font-size: 16px; font-weight: 500; color: #374151; margin-bottom: 5px; }
    .company-details { font-size: 12px; color: #4b5563; }
    .tax-info { font-size: 12px; color: #4b5563; margin-top: 10px; }
    
    .document-title { text-align: center; flex: 1; }
    .document-title h1 {
      font-size: 28px;
      font-weight: 700;
      color: #dc2626;
      border: 2px solid #dc2626;
      padding: 10px 30px;
      display: inline-block;
      background: #fef2f2;
    }
    
    .invoice-badge {
      background: #dc2626;
      color: white;
      padding: 5px 15px;
      border-radius: 20px;
      font-size: 12px;
      margin-top: 10px;
      display: inline-block;
    }
    
    .document-info {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 15px;
      margin-bottom: 25px;
      background: #fef2f2;
      padding: 15px;
      border-radius: 5px;
    }
    
    .info-row { display: flex; gap: 10px; }
    .info-label { font-weight: 600; color: #374151; min-width: 120px; }
    .info-value { color: #1f2937; }
    
    .section { margin-bottom: 25px; }
    .section-title {
      font-size: 16px;
      font-weight: 700;
      color: #dc2626;
      background: #fef2f2;
      padding: 8px 15px;
      margin-bottom: 15px;
      border-right: 4px solid #dc2626;
    }
    
    .supplier-info {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 10px;
      padding: 10px;
      border: 1px solid #e5e7eb;
      border-radius: 5px;
    }
    
    .items-table {
      width: 100%;
      border-collapse: collapse;
      margin-bottom: 20px;
    }
    
    .items-table th {
      background: #dc2626;
      color: white;
      padding: 12px 10px;
      text-align: right;
      font-weight: 600;
    }
    
    .items-table td {
      padding: 10px;
      border-bottom: 1px solid #e5e7eb;
      text-align: right;
    }
    
    .items-table tr:nth-child(even) { background: #f9fafb; }
    .items-table .number-col { text-align: center; width: 50px; }
    .items-table .qty-col { text-align: center; width: 80px; }
    .items-table .price-col { text-align: left; width: 120px; }
    
    .totals-section {
      display: flex;
      justify-content: flex-end;
      margin-bottom: 25px;
    }
    
    .totals-box {
      width: 300px;
      border: 2px solid #dc2626;
      border-radius: 5px;
      overflow: hidden;
    }
    
    .total-row {
      display: flex;
      justify-content: space-between;
      padding: 10px 15px;
      border-bottom: 1px solid #fecaca;
    }
    
    .total-row:last-child {
      border-bottom: none;
      background: #dc2626;
      color: white;
      font-weight: 700;
      font-size: 16px;
    }
    
    .payment-info {
      background: #fef2f2;
      padding: 15px;
      border-radius: 5px;
      margin-bottom: 25px;
    }
    
    .payment-grid {
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      gap: 15px;
    }
    
    .payment-item {
      text-align: center;
      padding: 10px;
      background: white;
      border-radius: 5px;
      border: 1px solid #fecaca;
    }
    
    .payment-label { font-size: 12px; color: #6b7280; margin-bottom: 5px; }
    .payment-value { font-weight: 700; color: #dc2626; }
    
    .status-badge {
      display: inline-block;
      padding: 5px 15px;
      border-radius: 20px;
      font-size: 12px;
      font-weight: 600;
    }
    
    .status-pending { background: #fef3c7; color: #92400e; }
    .status-paid { background: #d1fae5; color: #065f46; }
    .status-partially_paid { background: #dbeafe; color: #1e40af; }
    
    .footer {
      margin-top: 30px;
      padding-top: 15px;
      border-top: 1px solid #e5e7eb;
      text-align: center;
      font-size: 11px;
      color: #6b7280;
    }
    
    @media print {
      body { padding: 0; }
      .invoice-container { border: none; padding: 10mm; }
      .no-print { display: none !important; }
    }
    
    .print-bar {
      position: fixed;
      top: 0;
      left: 0;
      right: 0;
      background: #dc2626;
      color: white;
      padding: 10px 20px;
      display: flex;
      justify-content: space-between;
      align-items: center;
      z-index: 1000;
      box-shadow: 0 2px 10px rgba(0,0,0,0.2);
    }
    
    .print-bar button {
      background: white;
      color: #dc2626;
      border: none;
      padding: 8px 20px;
      border-radius: 5px;
      cursor: pointer;
      font-weight: 600;
      font-size: 14px;
      margin-right: 10px;
    }
    
    .print-bar button:hover { background: #fef2f2; }
    .print-spacer { height: 60px; }
    
    .company-logo {
      width: 100px;
      height: 100px;
      object-fit: contain;
    }
  </style>
</head>
<body>
  <div class="print-bar no-print">
    <span>فاتورة مورد - ${invoice.invoice_number}</span>
    <div>
      <button onclick="window.print()">🖨️ طباعة</button>
      <button onclick="window.close()" style="background: #fee2e2; color: #dc2626;">✕ إغلاق</button>
    </div>
  </div>
  <div class="print-spacer no-print"></div>
  
  <div class="invoice-container">
    <div class="header">
      <div class="company-header">
        <div class="company-name-ar">${COMPANY_SETTINGS.nameAr}</div>
        <div class="company-name-en">${COMPANY_SETTINGS.nameEn}</div>
        <div class="company-details">
          <div>العنوان: ${COMPANY_SETTINGS.address}</div>
          <div>تليفون: ${COMPANY_SETTINGS.phone} | فاكس: ${COMPANY_SETTINGS.fax}</div>
          <div>البريد الإلكتروني: ${COMPANY_SETTINGS.email}</div>
        </div>
        <div class="tax-info">${getTaxInfo()}</div>
      </div>
      <div class="document-title">
        <h1>فاتورة مورد</h1>
        <div class="invoice-badge">مستحقة الدفع</div>
      </div>
      <div>
        <img src="/images/image.png" alt="Misr Motors Logo" class="company-logo" />
      </div>
    </div>
    
    <div class="document-info">
      <div class="info-row">
        <span class="info-label">رقم الفاتورة:</span>
        <span class="info-value">${invoice.invoice_number}</span>
      </div>
      <div class="info-row">
        <span class="info-label">تاريخ الفاتورة:</span>
        <span class="info-value">${formatArabicDate(invoice.invoice_date)}</span>
      </div>
      <div class="info-row">
        <span class="info-label">رقم أمر الشراء:</span>
        <span class="info-value">${po.po_number || "-"}</span>
      </div>
      <div class="info-row">
        <span class="info-label">تاريخ الاستحقاق:</span>
        <span class="info-value">${formatArabicDate(invoice.due_date)}</span>
      </div>
      <div class="info-row">
        <span class="info-label">الحالة:</span>
        <span class="status-badge status-${invoice.status}">${
          invoice.status === "pending"
            ? "قيد الا��تظار"
            : invoice.status === "paid"
              ? "مدفوعة"
              : invoice.status === "partially_paid"
                ? "مدفوعة جزئياً"
                : invoice.status
        }</span>
      </div>
      <div class="info-row">
        <span class="info-label">نوع الدفع:</span>
        <span class="info-value">${
          paymentType === "hybrid"
            ? "هجين (مقدم + أقساط)"
            : paymentType === "installments"
              ? "أقساط"
              : paymentType === "cash"
                ? "نقدي"
                : paymentType === "bank_transfer"
                  ? "تحويل بنكي"
                  : paymentType
        }</span>
      </div>
    </div>
    
    <div class="section">
      <div class="section-title">بيانات المورد</div>
      <div class="supplier-info">
        <div class="info-row">
          <span class="info-label">اسم المورد:</span>
          <span class="info-value">${supplier.supplier_name || "-"}</span>
        </div>
        <div class="info-row">
          <span class="info-label">الهاتف:</span>
          <span class="info-value">${supplier.phone || "-"}</span>
        </div>
        <div class="info-row">
          <span class="info-label">العنوان:</span>
          <span class="info-value">${supplier.address || "-"}</span>
        </div>
        <div class="info-row">
          <span class="info-label">المدينة:</span>
          <span class="info-value">${supplier.city || "-"}</span>
        </div>
      </div>
    </div>
    
    <div class="section">
      <div class="section-title">الأصناف</div>
      <table class="items-table">
        <thead>
          <tr>
            <th class="number-col">م</th>
            <th>الصنف</th>
            <th>الكود</th>
            <th class="qty-col">الكمية</th>
            <th class="price-col">سعر الوحدة</th>
            <th class="price-col">الإجمالي</th>
          </tr>
        </thead>
        <tbody>
          ${items
            .map(
              (item: any, index: number) => `
            <tr>
              <td class="number-col">${toArabicNumbers(index + 1)}</td>
              <td>${item.products?.product_name || item.item_name_snapshot || item.outsourced_name || "-"}</td>
              <td>${item.products?.sku || (item.item_type === "outsourced" ? "خارجي" : "-")}</td>
              <td class="qty-col">${toArabicNumbers(item.quantity)}</td>
              <td class="price-col">${formatArabicCurrency(item.unit_price || 0)}</td>
              <td class="price-col">${formatArabicCurrency(item.total || 0)}</td>
            </tr>
          `,
            )
            .join("")}
        </tbody>
      </table>
    </div>
    
    <div class="totals-section">
      <div class="totals-box">
        <div class="total-row">
          <span>إجمالي الفاتورة</span>
          <span>${formatArabicCurrency(invoice.amount || 0)}</span>
        </div>
        <div class="total-row">
          <span>المدفوع</span>
          <span>${formatArabicCurrency(invoice.paid_amount || 0)}</span>
        </div>
        <div class="total-row">
          <span>المتبقي</span>
          <span>${formatArabicCurrency((invoice.amount || 0) - (invoice.paid_amount || 0))}</span>
        </div>
      </div>
    </div>
    
    ${
      paymentType === "hybrid"
        ? `
    <div class="section">
      <div class="section-title">تفاصيل الدفع الهجين</div>
      <div class="payment-info">
        <div class="payment-grid">
          <div class="payment-item">
            <div class="payment-label">المقدم</div>
            <div class="payment-value">${formatArabicCurrency(invoice.down_payment_amount || 0)}</div>
          </div>
          <div class="payment-item">
            <div class="payment-label">المتبقي</div>
            <div class="payment-value">${formatArabicCurrency(invoice.remaining_amount || 0)}</div>
          </div>
          <div class="payment-item">
            <div class="payment-label">عدد الأقساط</div>
            <div class="payment-value">${toArabicNumbers(invoice.remaining_installment_months || 0)} شهر</div>
          </div>
          <div class="payment-item">
            <div class="payment-label">القسط الشهري</div>
            <div class="payment-value">${formatArabicCurrency(invoice.monthly_amount || 0)}</div>
          </div>
          <div class="payment-item">
            <div class="payment-label">تاريخ استحقاق المقدم</div>
            <div class="payment-value">${formatArabicDate(invoice.down_payment_due_date)}</div>
          </div>
          <div class="payment-item">
            <div class="payment-label">بداية الأقساط</div>
            <div class="payment-value">${formatArabicDate(invoice.payment_start_date)}</div>
          </div>
        </div>
      </div>
    </div>
    `
        : ""
    }
    
    <div class="footer">
      <p>تم إنشاء هذه الفاتورة آلياً من نظام إدارة الموارد</p>
      <p>للاستفسار: 02-12242222</p>
    </div>
  </div>
</body>
</html>
    `

    return new NextResponse(html, {
      headers: { "Content-Type": "text/html; charset=utf-8" },
    })
  } catch (error) {
    console.error("AP Invoice PDF error:", error)
    return NextResponse.json({ error: "Failed to generate PDF" }, { status: 500 })
  }
}

function generateErrorHtml(title: string, details: string): string {
  return `
<!DOCTYPE html>
<html dir="rtl" lang="ar">
<head>
  <meta charset="UTF-8">
  <title>خطأ</title>
  <style>
    body { font-family: 'Segoe UI', sans-serif; display: flex; justify-content: center; align-items: center; height: 100vh; margin: 0; background: #f3f4f6; }
    .error-box { background: white; padding: 40px; border-radius: 10px; box-shadow: 0 4px 20px rgba(0,0,0,0.1); text-align: center; }
    h1 { color: #dc2626; }
    .details { font-size: 12px; color: #9ca3af; background: #f9fafb; padding: 10px; border-radius: 5px; margin-top: 15px; }
    button { background: #dc2626; color: white; border: none; padding: 10px 20px; border-radius: 5px; cursor: pointer; margin-top: 15px; }
  </style>
</head>
<body>
  <div class="error-box">
    <h1>⚠️ ${title}</h1>
    <div class="details">${details}</div>
    <button onclick="window.close()">إغلاق</button>
  </div>
</body>
</html>
  `
}
