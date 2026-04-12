import { NextResponse } from "next/server"
import { getAdminClient } from "@/lib/supabase/admin"

export const dynamic = "force-dynamic"

export async function GET(request: Request) {
  try {
    const supabase = getAdminClient()
    const { searchParams } = new URL(request.url)
    const reportType = searchParams.get("type") || "purchases"

    let data: any[] = []

    switch (reportType) {
      case "purchases":
        // Suppliers with purchase data
        const { data: purchaseData, error: purchaseError } = await supabase
          .from("report_purchase_by_supplier")
          .select("*")
        if (purchaseError) throw purchaseError
        data = purchaseData || []
        break

      case "ap_aging":
        // Supplier AP aging
        const { data: apData, error: apError } = await supabase
          .from("report_ap_aging")
          .select("*")
          .neq("status", "paid")
        if (apError) throw apError

        // Group by supplier
        const supplierAP: Record<string, any> = {}
        ;(apData || []).forEach((inv) => {
          if (!supplierAP[inv.supplier_id]) {
            supplierAP[inv.supplier_id] = {
              supplier_id: inv.supplier_id,
              supplier_name: inv.supplier_name,
              supplier_email: inv.supplier_email,
              supplier_phone: inv.supplier_phone,
              total_outstanding: 0,
              overdue_amount: 0,
              invoice_count: 0,
            }
          }
          supplierAP[inv.supplier_id].total_outstanding += inv.balance_due
          supplierAP[inv.supplier_id].invoice_count++
          if (inv.days_overdue > 0) {
            supplierAP[inv.supplier_id].overdue_amount += inv.balance_due
          }
        })
        data = Object.values(supplierAP)
        break

      case "directory":
        // Full supplier directory
        const { data: dirData, error: dirError } = await supabase
          .from("suppliers")
          .select("*")
          .eq("is_active", true)
          .order("supplier_name")
        if (dirError) throw dirError
        data = dirData || []
        break

      default:
        return NextResponse.json({ error: "Invalid report type" }, { status: 400 })
    }

    return NextResponse.json({ data, reportType })
  } catch (error: any) {
    console.error("Supplier Report Error:", error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
