import { NextResponse } from "next/server"
import { createAdminClient } from "@/lib/supabase/server"

export const dynamic = "force-dynamic"

export async function GET() {
  try {
    const adminClient = createAdminClient()

    // Fetch employees with "operations" department or position
    const { data: employees, error: empError } = await adminClient
      .from("hr_employees")
      .select(`
        employee_id,
        full_name,
        phone,
        email,
        employment_status,
        hire_date,
        position:job_positions!hr_employees_position_id_fkey (
          position_title,
          position_code
        ),
        department:departments!hr_employees_department_id_fkey (
          department_id,
          department_name,
          department_code
        )
      `)
      .eq("employment_status", "active")

    if (empError) {
      console.error("Error fetching employees:", empError)
      return NextResponse.json({ error: empError.message }, { status: 500 })
    }

    // Filter to operations employees — by department name OR position title/code
    const operationsEmployees = (employees || []).filter((emp: any) => {
      const title = emp.position?.position_title?.toLowerCase() || ""
      const code = emp.position?.position_code?.toLowerCase() || ""
      const deptName = emp.department?.department_name?.toLowerCase() || ""
      const deptCode = emp.department?.department_code?.toLowerCase() || ""
      return (
        title.includes("operations") ||
        code.includes("operations") ||
        deptName.includes("operations") ||
        deptName.includes("opertaions") || // handle common typo
        deptCode.includes("ope")
      )
    })

    const employeeIds = operationsEmployees.map((e: any) => e.employee_id)

    if (employeeIds.length === 0) {
      return NextResponse.json([])
    }

    // Fetch current (active) maintenance work orders assigned to these employees
    const { data: currentWorkOrders } = await adminClient
      .from("maintenance_work_orders")
      .select(`
        work_order_id,
        work_order_number,
        title,
        description,
        status,
        priority,
        category,
        assigned_to,
        scheduled_date,
        scheduled_time,
        created_at,
        started_at,
        completed_at,
        customer_name,
        customers ( customer_name ),
        sales_orders!maintenance_work_orders_sales_order_id_fkey ( so_number )
      `)
      .in("assigned_to", employeeIds)
      .in("status", ["pending", "in_progress"])
      .order("created_at", { ascending: false })

    // Fetch past (completed) work orders
    const { data: pastWorkOrders } = await adminClient
      .from("maintenance_work_orders")
      .select(`
        work_order_id,
        work_order_number,
        title,
        status,
        priority,
        category,
        assigned_to,
        scheduled_date,
        created_at,
        started_at,
        completed_at,
        customer_name,
        customers ( customer_name )
      `)
      .in("assigned_to", employeeIds)
      .eq("status", "completed")
      .order("completed_at", { ascending: false })
      .limit(50)

    // Fetch ALL delivery permits where these employees are assigned (courier_id stores the operations employee)
    const { data: allDeliveryOrders } = await adminClient
      .from("delivery_permits")
      .select(`
        permit_id,
        permit_no,
        status,
        created_at,
        delivery_address,
        recipient_name,
        recipient_phone,
        driver_name,
        courier_id,
        prepared_by,
        allocated_by,
        out_for_delivery_by,
        out_for_delivery_at,
        customers ( customer_name )
      `)
      .in("courier_id", employeeIds)
      .order("created_at", { ascending: false })
      .limit(100)

    // Split into current vs past
    const completedStatuses = ["DELIVERED", "SUBMITTED_SIGNED"]
    const currentDeliveryOrders = (allDeliveryOrders || []).filter(dp => !completedStatuses.includes(dp.status))
    const pastDeliveryOrders = (allDeliveryOrders || []).filter(dp => completedStatuses.includes(dp.status))

    // Build the response grouped by employee
    const result = operationsEmployees.map((emp: any) => {
      const empCurrentWOs = (currentWorkOrders || []).filter((wo: any) => wo.assigned_to === emp.employee_id)
      const empPastWOs = (pastWorkOrders || []).filter((wo: any) => wo.assigned_to === emp.employee_id)
      const empCurrentDPs = (currentDeliveryOrders || []).filter((dp: any) =>
        dp.courier_id === emp.employee_id
      )
      const empPastDPs = (pastDeliveryOrders || []).filter((dp: any) =>
        dp.courier_id === emp.employee_id
      )

      return {
        employee_id: emp.employee_id,
        full_name: emp.full_name,
        phone: emp.phone,
        email: emp.email,
        position_title: emp.position?.position_title || "Operations",
        hire_date: emp.hire_date,
        current_work_orders: empCurrentWOs.map((wo: any) => ({
          ...wo,
          customer_display: wo.customers?.customer_name || wo.customer_name || "N/A",
          so_number: Array.isArray(wo.sales_orders) ? wo.sales_orders[0]?.so_number : wo.sales_orders?.so_number,
        })),
        past_work_orders: empPastWOs.map((wo: any) => ({
          ...wo,
          customer_display: wo.customers?.customer_name || wo.customer_name || "N/A",
        })),
        current_delivery_orders: empCurrentDPs.map((dp: any) => ({
          ...dp,
          customer_display: Array.isArray(dp.customers) ? dp.customers[0]?.customer_name : dp.customers?.customer_name || "N/A",
        })),
        past_delivery_orders: empPastDPs.map((dp: any) => ({
          ...dp,
          customer_display: Array.isArray(dp.customers) ? dp.customers[0]?.customer_name : dp.customers?.customer_name || "N/A",
        })),
        stats: {
          active_work_orders: empCurrentWOs.length,
          completed_work_orders: empPastWOs.length,
          active_deliveries: empCurrentDPs.length,
          completed_deliveries: empPastDPs.length,
        },
      }
    })

    return NextResponse.json(result)
  } catch (error) {
    console.error("Error in operations employees endpoint:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
