import { getAdminClient } from "@/lib/supabase/admin"
import { NextResponse } from "next/server"

export const dynamic = "force-dynamic"

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
}

export async function OPTIONS() {
  return NextResponse.json({}, { headers: corsHeaders })
}

export async function GET() {
  try {
    const supabase = getAdminClient()

    // Get all lost sales
    const { data: lostSales, error } = await (supabase as any).from("lost_sales").select("*")

    if (error) throw error

    // Calculate summary
    const totalRequests = lostSales?.length || 0
    const totalQuantity = lostSales?.reduce((sum, item) => sum + (item.requested_quantity || 0), 0) || 0
    const uniqueProducts = new Set(lostSales?.map((item) => item.requested_item_name)).size
    const uniqueCustomers = new Set(lostSales?.filter((item) => item.customer_name).map((item) => item.customer_name))
      .size

    return NextResponse.json(
      {
        totalRequests,
        totalQuantity,
        uniqueProducts,
        uniqueCustomers,
      },
      { headers: corsHeaders },
    )
  } catch (error) {
    console.error("Error fetching lost sales summary:", error)
    return NextResponse.json(
      {
        totalRequests: 0,
        totalQuantity: 0,
        uniqueProducts: 0,
        uniqueCustomers: 0,
      },
      { headers: corsHeaders },
    )
  }
}
