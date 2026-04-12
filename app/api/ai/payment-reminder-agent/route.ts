import { createAdminClient } from "@/lib/supabase/admin"
import { NextResponse } from "next/server"

export const dynamic = "force-dynamic"

// Agentic AI Payment Reminder System
// This agent fetches AR invoices due in 5 days and sends email reminders

interface CustomerInvoice {
  invoice_id: number
  invoice_number: string
  customer_id: number
  customer_name: string
  customer_email: string
  amount: number
  collected_amount: number
  balance: number
  due_date: string
  installment_months: number
  months_paid: number
  status: string
}

interface EmailResult {
  success: boolean
  customerId: number
  customerName: string
  customerEmail: string
  invoiceNumber: string
  amount: number
  dueDate: string
  error?: string
}

// Calculate days until due date
function getDaysUntilDue(dueDate: string, monthsPaid: number, installmentMonths: number): number {
  const today = new Date()
  today.setHours(0, 0, 0, 0)

  // For installment payments, calculate next due date based on months paid
  const originalDueDate = new Date(dueDate)
  const nextDueDate = new Date(originalDueDate)

  if (installmentMonths > 1 && monthsPaid < installmentMonths) {
    // Next payment is due: original due date + months_paid months
    nextDueDate.setMonth(originalDueDate.getMonth() + monthsPaid)
  }

  nextDueDate.setHours(0, 0, 0, 0)
  const diffTime = nextDueDate.getTime() - today.getTime()
  const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24))

  return diffDays
}

// Format currency for email
function formatCurrency(amount: number): string {
  return new Intl.NumberFormat("en-EG", {
    style: "currency",
    currency: "EGP",
    minimumFractionDigits: 2,
  }).format(amount)
}

// Format date for email
function formatDate(dateString: string): string {
  return new Date(dateString).toLocaleDateString("en-US", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  })
}

// Generate email HTML template
function generateEmailHTML(invoice: CustomerInvoice, daysUntilDue: number): string {
  const amountDue = invoice.amount - invoice.collected_amount
  const isInstallment = invoice.installment_months > 1
  const installmentAmount = isInstallment ? invoice.amount / invoice.installment_months : amountDue

  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Payment Reminder</title>
</head>
<body style="margin: 0; padding: 0; font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; background-color: #f5f5f5;">
  <table role="presentation" style="width: 100%; border-collapse: collapse;">
    <tr>
      <td align="center" style="padding: 40px 0;">
        <table role="presentation" style="width: 600px; border-collapse: collapse; background-color: #ffffff; border-radius: 12px; box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);">
          <!-- Header -->
          <tr>
            <td style="padding: 40px 40px 20px; background: linear-gradient(135deg, #1e40af 0%, #3b82f6 100%); border-radius: 12px 12px 0 0;">
              <h1 style="margin: 0; color: #ffffff; font-size: 28px; font-weight: 600;">Payment Reminder</h1>
              <p style="margin: 10px 0 0; color: #bfdbfe; font-size: 14px;">Invoice #${invoice.invoice_number}</p>
            </td>
          </tr>
          
          <!-- Body -->
          <tr>
            <td style="padding: 40px;">
              <p style="margin: 0 0 20px; color: #374151; font-size: 16px; line-height: 1.6;">
                Dear <strong>${invoice.customer_name}</strong>,
              </p>
              
              <p style="margin: 0 0 30px; color: #374151; font-size: 16px; line-height: 1.6;">
                This is a friendly reminder that your payment is due in <strong style="color: #dc2626;">${daysUntilDue} days</strong>.
              </p>
              
              <!-- Payment Details Box -->
              <table role="presentation" style="width: 100%; border-collapse: collapse; background-color: #f8fafc; border-radius: 8px; margin-bottom: 30px;">
                <tr>
                  <td style="padding: 24px;">
                    <table role="presentation" style="width: 100%; border-collapse: collapse;">
                      <tr>
                        <td style="padding: 8px 0; color: #6b7280; font-size: 14px;">Invoice Number:</td>
                        <td style="padding: 8px 0; color: #111827; font-size: 14px; font-weight: 600; text-align: right;">${invoice.invoice_number}</td>
                      </tr>
                      <tr>
                        <td style="padding: 8px 0; color: #6b7280; font-size: 14px;">Due Date:</td>
                        <td style="padding: 8px 0; color: #111827; font-size: 14px; font-weight: 600; text-align: right;">${formatDate(invoice.due_date)}</td>
                      </tr>
                      ${
                        isInstallment
                          ? `
                      <tr>
                        <td style="padding: 8px 0; color: #6b7280; font-size: 14px;">Payment Progress:</td>
                        <td style="padding: 8px 0; color: #111827; font-size: 14px; font-weight: 600; text-align: right;">${invoice.months_paid} of ${invoice.installment_months} installments paid</td>
                      </tr>
                      <tr>
                        <td style="padding: 8px 0; color: #6b7280; font-size: 14px;">Monthly Installment:</td>
                        <td style="padding: 8px 0; color: #111827; font-size: 14px; font-weight: 600; text-align: right;">${formatCurrency(installmentAmount)}</td>
                      </tr>
                      `
                          : ""
                      }
                      <tr>
                        <td colspan="2" style="padding: 16px 0 8px; border-top: 1px solid #e5e7eb;"></td>
                      </tr>
                      <tr>
                        <td style="padding: 8px 0; color: #111827; font-size: 18px; font-weight: 600;">Amount Due:</td>
                        <td style="padding: 8px 0; color: #dc2626; font-size: 24px; font-weight: 700; text-align: right;">${formatCurrency(isInstallment ? installmentAmount : amountDue)}</td>
                      </tr>
                    </table>
                  </td>
                </tr>
              </table>
              
              <p style="margin: 0 0 30px; color: #374151; font-size: 16px; line-height: 1.6;">
                Please ensure your payment is made by the due date to avoid any late fees or service interruptions.
              </p>
              
              <!-- CTA Button -->
              <table role="presentation" style="width: 100%; border-collapse: collapse;">
                <tr>
                  <td align="center">
                    <a href="#" style="display: inline-block; padding: 14px 32px; background: linear-gradient(135deg, #1e40af 0%, #3b82f6 100%); color: #ffffff; text-decoration: none; font-size: 16px; font-weight: 600; border-radius: 8px;">
                      Make Payment
                    </a>
                  </td>
                </tr>
              </table>
              
              <p style="margin: 30px 0 0; color: #6b7280; font-size: 14px; line-height: 1.6;">
                If you have already made this payment, please disregard this reminder. For any questions, please contact our accounts department.
              </p>
            </td>
          </tr>
          
          <!-- Footer -->
          <tr>
            <td style="padding: 24px 40px; background-color: #f8fafc; border-radius: 0 0 12px 12px; border-top: 1px solid #e5e7eb;">
              <p style="margin: 0; color: #6b7280; font-size: 12px; text-align: center;">
                This is an automated reminder from Misr Motors.<br>
                Please do not reply to this email.
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>
  `
}

// Send email using Resend API (or webhook to external service)
async function sendPaymentReminderEmail(
  invoice: CustomerInvoice,
  daysUntilDue: number,
  webhookUrl?: string,
): Promise<EmailResult> {
  const result: EmailResult = {
    success: false,
    customerId: invoice.customer_id,
    customerName: invoice.customer_name,
    customerEmail: invoice.customer_email,
    invoiceNumber: invoice.invoice_number,
    amount: invoice.amount - invoice.collected_amount,
    dueDate: invoice.due_date,
  }

  try {
    // If no email address, skip
    if (!invoice.customer_email) {
      result.error = "No email address for customer"
      return result
    }

    const emailContent = generateEmailHTML(invoice, daysUntilDue)
    const installmentAmount =
      invoice.installment_months > 1
        ? invoice.amount / invoice.installment_months
        : invoice.amount - invoice.collected_amount

    // Option 1: Send via webhook (n8n, Zapier, etc.)
    if (webhookUrl) {
      const response = await fetch(webhookUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          event: "payment.reminder",
          timestamp: new Date().toISOString(),
          data: {
            to: invoice.customer_email,
            subject: `Payment Reminder - Invoice #${invoice.invoice_number} Due in ${daysUntilDue} Days`,
            html: emailContent,
            invoice: {
              invoiceNumber: invoice.invoice_number,
              customerName: invoice.customer_name,
              customerEmail: invoice.customer_email,
              amountDue: installmentAmount,
              totalBalance: invoice.amount - invoice.collected_amount,
              dueDate: invoice.due_date,
              daysUntilDue,
              isInstallment: invoice.installment_months > 1,
              installmentProgress: `${invoice.months_paid}/${invoice.installment_months}`,
            },
          },
        }),
      })

      if (!response.ok) {
        throw new Error(`Webhook failed: ${response.statusText}`)
      }

      result.success = true
      return result
    }

    // Option 2: Use Resend API directly (if RESEND_API_KEY is set)
    const resendApiKey = process.env.RESEND_API_KEY
    if (resendApiKey) {
      const response = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${resendApiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          from: "Misr Motors <noreply@yourdomain.com>",
          to: [invoice.customer_email],
          subject: `Payment Reminder - Invoice #${invoice.invoice_number} Due in ${daysUntilDue} Days`,
          html: emailContent,
        }),
      })

      if (!response.ok) {
        const error = await response.json()
        throw new Error(error.message || "Resend API failed")
      }

      result.success = true
      return result
    }

    // Option 3: Log for manual processing (no email service configured)
    console.log(`[Payment Reminder Agent] Email would be sent to ${invoice.customer_email}`)
    console.log(`  Invoice: ${invoice.invoice_number}`)
    console.log(`  Amount: ${formatCurrency(installmentAmount)}`)
    console.log(`  Due: ${formatDate(invoice.due_date)} (${daysUntilDue} days)`)

    result.success = true
    result.error = "No email service configured - logged for manual processing"
    return result
  } catch (error: any) {
    result.error = error.message
    return result
  }
}

// GET: Fetch invoices due in 5 days (preview mode)
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url)
    const daysAhead = Number.parseInt(searchParams.get("days") || "5")

    const supabase = createAdminClient()

    // Fetch all pending/partially_paid AR invoices with customer data
    const { data: invoices, error } = await supabase
      .from("accounts_receivable")
      .select(`
        invoice_id,
        invoice_number,
        customer_id,
        amount,
        collected_amount,
        due_date,
        installment_months,
        months_paid,
        status,
        customers:customer_id (customer_name, email)
      `)
      .in("status", ["pending", "partially_paid"])
      .order("due_date", { ascending: true })

    if (error) throw error

    // Filter invoices due within the specified days
    const upcomingInvoices: CustomerInvoice[] = []

    for (const invoice of invoices || []) {
      const daysUntilDue = getDaysUntilDue(invoice.due_date, invoice.months_paid || 0, invoice.installment_months || 1)

      // Include invoices due within the specified window (e.g., 5 days)
      if (daysUntilDue > 0 && daysUntilDue <= daysAhead) {
        upcomingInvoices.push({
          invoice_id: invoice.invoice_id,
          invoice_number: invoice.invoice_number,
          customer_id: invoice.customer_id,
          customer_name: (invoice.customers as any)?.customer_name || "Unknown",
          customer_email: (invoice.customers as any)?.email || "",
          amount: invoice.amount,
          collected_amount: invoice.collected_amount || 0,
          balance: invoice.amount - (invoice.collected_amount || 0),
          due_date: invoice.due_date,
          installment_months: invoice.installment_months || 1,
          months_paid: invoice.months_paid || 0,
          status: invoice.status,
        })
      }
    }

    return NextResponse.json({
      success: true,
      daysAhead,
      totalInvoices: upcomingInvoices.length,
      invoices: upcomingInvoices.map((inv) => ({
        ...inv,
        daysUntilDue: getDaysUntilDue(inv.due_date, inv.months_paid, inv.installment_months),
        amountDue: inv.installment_months > 1 ? inv.amount / inv.installment_months : inv.balance,
      })),
    })
  } catch (error: any) {
    console.error("[Payment Reminder Agent] Error:", error)
    return NextResponse.json(
      {
        success: false,
        error: error.message,
      },
      { status: 500 },
    )
  }
}

// POST: Execute the agent - send reminder emails
export async function POST(request: Request) {
  try {
    const body = await request.json()
    const daysAhead = body.daysAhead || 5
    const webhookUrl = body.webhookUrl // Optional: n8n or other webhook URL
    const dryRun = body.dryRun || false // If true, don't actually send emails

    const supabase = createAdminClient()

    // Fetch all pending/partially_paid AR invoices with customer data
    const { data: invoices, error } = await supabase
      .from("accounts_receivable")
      .select(`
        invoice_id,
        invoice_number,
        customer_id,
        amount,
        collected_amount,
        due_date,
        installment_months,
        months_paid,
        status,
        customers:customer_id (customer_name, email)
      `)
      .in("status", ["pending", "partially_paid"])
      .order("due_date", { ascending: true })

    if (error) throw error

    // Filter and process invoices
    const results: EmailResult[] = []
    let sentCount = 0
    let failedCount = 0

    for (const invoice of invoices || []) {
      const daysUntilDue = getDaysUntilDue(invoice.due_date, invoice.months_paid || 0, invoice.installment_months || 1)

      // Only process invoices due within the specified window
      if (daysUntilDue > 0 && daysUntilDue <= daysAhead) {
        const customerInvoice: CustomerInvoice = {
          invoice_id: invoice.invoice_id,
          invoice_number: invoice.invoice_number,
          customer_id: invoice.customer_id,
          customer_name: (invoice.customers as any)?.customer_name || "Unknown",
          customer_email: (invoice.customers as any)?.email || "",
          amount: invoice.amount,
          collected_amount: invoice.collected_amount || 0,
          balance: invoice.amount - (invoice.collected_amount || 0),
          due_date: invoice.due_date,
          installment_months: invoice.installment_months || 1,
          months_paid: invoice.months_paid || 0,
          status: invoice.status,
        }

        if (dryRun) {
          // Dry run - just log what would happen
          results.push({
            success: true,
            customerId: customerInvoice.customer_id,
            customerName: customerInvoice.customer_name,
            customerEmail: customerInvoice.customer_email,
            invoiceNumber: customerInvoice.invoice_number,
            amount: customerInvoice.balance,
            dueDate: customerInvoice.due_date,
            error: "DRY RUN - No email sent",
          })
          sentCount++
        } else {
          // Actually send the email
          const result = await sendPaymentReminderEmail(customerInvoice, daysUntilDue, webhookUrl)
          results.push(result)

          if (result.success) {
            sentCount++
          } else {
            failedCount++
          }
        }
      }
    }

    // Log agent execution
    console.log(`[Payment Reminder Agent] Execution complete:`)
    console.log(`  - Invoices processed: ${results.length}`)
    console.log(`  - Emails sent: ${sentCount}`)
    console.log(`  - Failed: ${failedCount}`)

    return NextResponse.json({
      success: true,
      dryRun,
      summary: {
        totalProcessed: results.length,
        emailsSent: sentCount,
        failed: failedCount,
        daysAhead,
      },
      results,
    })
  } catch (error: any) {
    console.error("[Payment Reminder Agent] Error:", error)
    return NextResponse.json(
      {
        success: false,
        error: error.message,
      },
      { status: 500 },
    )
  }
}
