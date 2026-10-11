import { type NextRequest, NextResponse } from "next/server"
import { createAdminClient } from "@/lib/supabase/admin"
import { COMPANY_SETTINGS, getTaxInfo } from "@/lib/company-settings"
import { escapeHtml } from "@/lib/html-escape"
import { PRINT_CSS, printHeader, docTitle } from "@/lib/print/print-theme"

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
  <title>فاتورة مورد - ${escapeHtml(invoice.invoice_number)}</title>
  <style>
    ${PRINT_CSS}
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
  </style>
</head>
<body>
  <div class="print-bar no-print">
    <span>فاتورة مورد - ${escapeHtml(invoice.invoice_number)}</span>
    <div>
      <button onclick="window.print()">🖨️ طباعة</button>
      <button onclick="window.close()" style="background: #fee2e2; color: #dc2626;">✕ إغلاق</button>
    </div>
  </div>
  <div class="print-spacer no-print"></div>
  
  <div class="invoice-container">
    ${printHeader({
      logoHtml: `<img src="/images/image.png" alt="Misr Motors Logo" class="company-logo" />`,
      company: {
        nameAr: `${COMPANY_SETTINGS.nameAr}`,
        nameEn: `${COMPANY_SETTINGS.nameEn}`,
        detailsHtml: `<div>العنوان: ${COMPANY_SETTINGS.address}</div>
          <div>تليفون: ${COMPANY_SETTINGS.phone} | فاكس: ${COMPANY_SETTINGS.fax}</div>
          <div>البريد الإلكتروني: ${COMPANY_SETTINGS.email}</div>`,
      },
      taxInfo: `${getTaxInfo()}`,
    })}
    ${docTitle({ titleAr: `فاتورة مورد`, noteHtml: `<div class="invoice-badge">مستحقة الدفع</div>` })}
    
    <section class="pm-info">
    <div class="pm-fields">
      <div class="pm-field">
        <span class="pm-label">رقم الفاتورة:</span>
        <span class="pm-value">${escapeHtml(invoice.invoice_number)}</span>
      </div>
      <div class="pm-field">
        <span class="pm-label">تاريخ الفاتورة:</span>
        <span class="pm-value">${formatArabicDate(invoice.invoice_date)}</span>
      </div>
      <div class="pm-field">
        <span class="pm-label">رقم أمر الشراء:</span>
        <span class="pm-value">${escapeHtml(po.po_number || "-")}</span>
      </div>
      <div class="pm-field">
        <span class="pm-label">تاريخ الاستحقاق:</span>
        <span class="pm-value">${formatArabicDate(invoice.due_date)}</span>
      </div>
      <div class="pm-field">
        <span class="pm-label">الحالة:</span>
        <span class="pm-value status-badge status-${escapeHtml(invoice.status)}">${
          invoice.status === "pending"
            ? "قيد الا��تظار"
            : invoice.status === "paid"
              ? "مدفوعة"
              : invoice.status === "partially_paid"
                ? "مدفوعة جزئياً"
                : escapeHtml(invoice.status)
        }</span>
      </div>
      <div class="pm-field">
        <span class="pm-label">نوع الدفع:</span>
        <span class="pm-value">${
          paymentType === "hybrid"
            ? "هجين (مقدم + أقساط)"
            : paymentType === "installments"
              ? "أقساط"
              : paymentType === "cash"
                ? "نقدي"
                : paymentType === "bank_transfer"
                  ? "تحويل بنكي"
                  : escapeHtml(paymentType)
        }</span>
      </div>
    </div>
    </section>
    
    <section class="pm-info">
      <div class="pm-info-title">بيانات المورد</div>
      <div class="pm-fields">
        <div class="pm-field pm-field-wide">
          <span class="pm-label">اسم المورد:</span>
          <span class="pm-value">${escapeHtml(supplier.supplier_name || "-")}</span>
        </div>
        <div class="pm-field">
          <span class="pm-label">الهاتف:</span>
          <span class="pm-value">${escapeHtml(supplier.phone || "-")}</span>
        </div>
        <div class="pm-field pm-field-wide">
          <span class="pm-label">العنوان:</span>
          <span class="pm-value">${escapeHtml(supplier.address || "-")}</span>
        </div>
        <div class="pm-field">
          <span class="pm-label">المدينة:</span>
          <span class="pm-value">${escapeHtml(supplier.city || "-")}</span>
        </div>
      </div>
    </section>
    
    <div class="section">
      <div class="pm-section-title">الأصناف</div>
      <table class="items-table pm-table">
        <thead>
          <tr>
            <th class="pm-center">م</th>
            <th>الصنف</th>
            <th>الكود</th>
            <th class="pm-num">الكمية</th>
            <th class="pm-num">سعر الوحدة</th>
            <th class="pm-num">الإجمالي</th>
          </tr>
        </thead>
        <tbody>
          ${items
            .map(
              (item: any, index: number) => `
            <tr>
              <td class="pm-center">${toArabicNumbers(index + 1)}</td>
              <td>${escapeHtml(item.products?.product_name || item.item_name_snapshot || item.outsourced_name || "-")}</td>
              <td>${escapeHtml(item.products?.sku || (item.item_type === "outsourced" ? "خارجي" : "-"))}</td>
              <td class="pm-num">${toArabicNumbers(item.quantity)}</td>
              <td class="pm-num">${formatArabicCurrency(item.unit_price || 0)}</td>
              <td class="pm-num">${formatArabicCurrency(item.total || 0)}</td>
            </tr>
          `,
            )
            .join("")}
        </tbody>
      </table>
    </div>
    
    <table class="pm-totals">
      <tr>
        <td>إجمالي الفاتورة</td>
        <td class="pm-num">${formatArabicCurrency(invoice.amount || 0)}</td>
      </tr>
      <tr>
        <td>المدفوع</td>
        <td class="pm-num">${formatArabicCurrency(invoice.paid_amount || 0)}</td>
      </tr>
      <tr class="pm-total-final">
        <td>المتبقي</td>
        <td class="pm-num">${formatArabicCurrency((invoice.amount || 0) - (invoice.paid_amount || 0))}</td>
      </tr>
    </table>
    
    ${
      paymentType === "hybrid"
        ? `
    <section class="pm-info">
      <div class="pm-info-title">تفاصيل الدفع الهجين</div>
      <div class="pm-fields">
          <div class="pm-field">
            <div class="pm-label">المقدم</div>
            <div class="pm-value">${formatArabicCurrency(invoice.down_payment_amount || 0)}</div>
          </div>
          <div class="pm-field">
            <div class="pm-label">المتبقي</div>
            <div class="pm-value">${formatArabicCurrency(invoice.remaining_amount || 0)}</div>
          </div>
          <div class="pm-field">
            <div class="pm-label">عدد الأقساط</div>
            <div class="pm-value">${toArabicNumbers(invoice.remaining_installment_months || 0)} شهر</div>
          </div>
          <div class="pm-field">
            <div class="pm-label">القسط الشهري</div>
            <div class="pm-value">${formatArabicCurrency(invoice.monthly_amount || 0)}</div>
          </div>
          <div class="pm-field">
            <div class="pm-label">تاريخ استحقاق المقدم</div>
            <div class="pm-value">${formatArabicDate(invoice.down_payment_due_date)}</div>
          </div>
          <div class="pm-field">
            <div class="pm-label">بداية الأقساط</div>
            <div class="pm-value">${formatArabicDate(invoice.payment_start_date)}</div>
          </div>
      </div>
    </section>
    `
        : ""
    }
    
    <div class="pm-footer">
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
    <h1>⚠️ ${escapeHtml(title)}</h1>
    <div class="details">${escapeHtml(details)}</div>
    <button onclick="window.close()">إغلاق</button>
  </div>
</body>
</html>
  `
}
