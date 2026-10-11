import { NextResponse } from "next/server"
import { getAdminClient } from "@/lib/supabase/admin"
import { arAging, salesByCustomer, whereNot } from "@/lib/reports/views"

export const dynamic = "force-dynamic"

export async function GET(request: Request) {
  try {
    const supabase = getAdminClient()
    const { searchParams } = new URL(request.url)
    const reportType = searchParams.get("type") || "sales"

    let data: any[] = []

    switch (reportType) {
      case "sales":
        // Customers with sales data (was the report_sales_by_customer view)
        data = await salesByCustomer(supabase)
        break

      case "ar_aging":
        // Customer AR aging (was the report_ar_aging view)
        const arData = whereNot(await arAging(supabase), "status", "paid")

        // Group by customer
        const customerAR: Record<string, any> = {}
        ;(arData || []).forEach((inv) => {
          if (!customerAR[inv.customer_id]) {
            customerAR[inv.customer_id] = {
              customer_id: inv.customer_id,
              customer_name: inv.customer_name,
              customer_email: inv.customer_email,
              customer_phone: inv.customer_phone,
              total_outstanding: 0,
              overdue_amount: 0,
              invoice_count: 0,
            }
          }
          customerAR[inv.customer_id].total_outstanding += inv.balance_due
          customerAR[inv.customer_id].invoice_count++
          if (inv.days_overdue > 0) {
            customerAR[inv.customer_id].overdue_amount += inv.balance_due
          }
        })
        data = Object.values(customerAR)
        break

      case "directory":
        // Full customer directory
        const { data: dirData, error: dirError } = await supabase
          .from("customers")
          .select("*")
          .eq("status", "active")
          .order("customer_name")
        if (dirError) throw dirError
        data = dirData || []
        break

      default:
        return NextResponse.json({ error: "Invalid report type" }, { status: 400 })
    }

    return NextResponse.json({ data, reportType })
  } catch (error: any) {
    console.error("Customer Report Error:", error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
