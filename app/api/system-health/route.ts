import { NextResponse } from "next/server"
import { createAdminClient } from "@/lib/supabase/admin"

export const dynamic = "force-dynamic"

interface HealthCheck {
  name: string
  status: "pass" | "fail" | "warn"
  message: string
  duration?: number
  details?: any
}

async function checkDatabaseConnection(): Promise<HealthCheck> {
  const start = Date.now()
  try {
    const supabase = createAdminClient()
    const { error } = await supabase.from("products").select("product_id").limit(1)
    const duration = Date.now() - start

    if (error) {
      return {
        name: "Database Connection",
        status: "fail",
        message: error.message,
        duration,
      }
    }

    return {
      name: "Database Connection",
      status: "pass",
      message: "Connected successfully",
      duration,
    }
  } catch (error) {
    return {
      name: "Database Connection",
      status: "fail",
      message: error instanceof Error ? error.message : "Unknown error",
      duration: Date.now() - start,
    }
  }
}

async function checkTable(tableName: string): Promise<HealthCheck> {
  const start = Date.now()
  try {
    const supabase = createAdminClient()
    const { error, count } = await supabase.from(tableName).select("*", { count: "exact", head: true })

    const duration = Date.now() - start

    if (error) {
      return {
        name: `Table: ${tableName}`,
        status: "fail",
        message: error.message,
        duration,
      }
    }

    return {
      name: `Table: ${tableName}`,
      status: "pass",
      message: `Accessible (${count || 0} rows)`,
      duration,
      details: { count },
    }
  } catch (error) {
    return {
      name: `Table: ${tableName}`,
      status: "fail",
      message: error instanceof Error ? error.message : "Unknown error",
      duration: Date.now() - start,
    }
  }
}

async function checkWorkflow(
  name: string,
  checks: () => Promise<{ success: boolean; message: string; details?: any }>,
): Promise<HealthCheck> {
  const start = Date.now()
  try {
    const result = await checks()
    return {
      name: `Workflow: ${name}`,
      status: result.success ? "pass" : "warn",
      message: result.message,
      duration: Date.now() - start,
      details: result.details,
    }
  } catch (error) {
    return {
      name: `Workflow: ${name}`,
      status: "fail",
      message: error instanceof Error ? error.message : "Unknown error",
      duration: Date.now() - start,
    }
  }
}

export async function GET() {
  const checks: HealthCheck[] = []

  // 1. Database connectivity
  checks.push(await checkDatabaseConnection())

  // 2. Core tables (run in parallel for speed)
  const coreTables = [
    "products",
    "customers",
    "suppliers",
    "inventory",
    "sales_orders",
    "sales_order_items",
    "purchase_orders",
    "purchase_order_items",
    "accounts_receivable",
    "accounts_payable",
    "balance_entries",
    "users",
    "delivery_permits",
    "payment_schedules",
    "couriers",
    "warehouses",
  ]

  const tableChecks = await Promise.all(coreTables.map((table) => checkTable(table)))
  checks.push(...tableChecks)

  // 3. Data consistency checks (run in parallel)
  const workflowChecks = await Promise.all([
    checkWorkflow("SO Totals Consistency", async () => {
      const supabase = createAdminClient()

      const { data: orders, error } = await supabase
        .from("sales_orders")
        .select(`so_id, so_number, total, subtotal, discount_amount, net_total`)
        .limit(50)

      if (error) {
        return { success: false, message: error.message }
      }

      // Check if net_total = subtotal - discount_amount (allowing for rounding)
      const mismatches: any[] = []
      for (const order of orders || []) {
        const subtotal = Number(order.subtotal) || 0
        const discount = Number(order.discount_amount) || 0
        const netTotal = Number(order.net_total) || Number(order.total) || 0
        const expected = subtotal - discount

        if (subtotal > 0 && Math.abs(expected - netTotal) > 1) {
          mismatches.push({
            soNumber: order.so_number,
            subtotal,
            discount,
            expected,
            netTotal,
          })
        }
      }

      if (mismatches.length > 0) {
        return {
          success: false,
          message: `${mismatches.length} orders have potential total mismatches`,
          details: mismatches.slice(0, 5),
        }
      }

      return { success: true, message: `${orders?.length || 0} orders verified` }
    }),

    checkWorkflow("AR Balance Consistency", async () => {
      const supabase = createAdminClient()

      const { data: invoices, error } = await supabase
        .from("accounts_receivable")
        .select("invoice_id, invoice_number, amount, collected_amount, balance")
        .limit(50)

      if (error) {
        return { success: false, message: error.message }
      }

      const mismatches: any[] = []
      for (const inv of invoices || []) {
        const expectedBalance = Number(inv.amount || 0) - Number(inv.collected_amount || 0)
        const actualBalance = Number(inv.balance || 0)

        if (Math.abs(expectedBalance - actualBalance) > 0.01) {
          mismatches.push({
            invoiceNumber: inv.invoice_number,
            amount: inv.amount,
            collected: inv.collected_amount,
            expectedBalance,
            actualBalance,
          })
        }
      }

      if (mismatches.length > 0) {
        return {
          success: false,
          message: `${mismatches.length} AR invoices have balance issues`,
          details: mismatches.slice(0, 5),
        }
      }

      return { success: true, message: `${invoices?.length || 0} AR invoices verified` }
    }),

    checkWorkflow("AP Balance Consistency", async () => {
      const supabase = createAdminClient()

      const { data: bills, error } = await supabase
        .from("accounts_payable")
        .select("invoice_id, invoice_number, amount, paid_amount, balance")
        .limit(50)

      if (error) {
        return { success: false, message: error.message }
      }

      const mismatches: any[] = []
      for (const bill of bills || []) {
        const expectedBalance = Number(bill.amount || 0) - Number(bill.paid_amount || 0)
        const actualBalance = Number(bill.balance || 0)

        if (Math.abs(expectedBalance - actualBalance) > 0.01) {
          mismatches.push({
            invoiceNumber: bill.invoice_number,
            amount: bill.amount,
            paid: bill.paid_amount,
            expectedBalance,
            actualBalance,
          })
        }
      }

      if (mismatches.length > 0) {
        return {
          success: false,
          message: `${mismatches.length} AP bills have balance issues`,
          details: mismatches.slice(0, 5),
        }
      }

      return { success: true, message: `${bills?.length || 0} AP bills verified` }
    }),

    checkWorkflow("Inventory Stock Levels", async () => {
      const supabase = createAdminClient()

      const { data: items, error } = await supabase
        .from("inventory")
        .select("inventory_id, product_id, quantity")
        .lt("quantity", 0)

      if (error) {
        return { success: false, message: error.message }
      }

      if (items && items.length > 0) {
        return {
          success: false,
          message: `${items.length} items have negative stock`,
          details: items.slice(0, 5),
        }
      }

      return { success: true, message: "No negative stock found" }
    }),

    checkWorkflow("Payment Schedule Integrity", async () => {
      const supabase = createAdminClient()

      // Check for orphaned payment schedules (no invoice or PO/SO)
      const { data: schedules, error } = await supabase
        .from("payment_schedules")
        .select("schedule_id, invoice_id, po_id, so_id, amount, status")
        .is("invoice_id", null)
        .is("po_id", null)
        .is("so_id", null)

      if (error) {
        return { success: false, message: error.message }
      }

      if (schedules && schedules.length > 0) {
        return {
          success: false,
          message: `${schedules.length} orphaned payment schedules found`,
          details: schedules.slice(0, 5),
        }
      }

      return { success: true, message: "Payment schedules valid" }
    }),

    checkWorkflow("Delivery Permit Status Flow", async () => {
      const supabase = createAdminClient()

      // Check for permits in invalid status
      const validStatuses = [
        "PENDING_WAREHOUSE",
        "READY_FOR_DELIVERY",
        "OUT_FOR_DELIVERY",
        "DELIVERED",
        "SUBMITTED_SIGNED",
        "APPROVED",
        "REJECTED",
      ]

      const { data: permits, error } = await supabase
        .from("delivery_permits")
        .select("permit_id, permit_no, status")
        .limit(100)

      if (error) {
        return { success: false, message: error.message }
      }

      const invalid = (permits || []).filter((p) => !validStatuses.includes(p.status))

      if (invalid.length > 0) {
        return {
          success: false,
          message: `${invalid.length} permits have invalid status`,
          details: invalid.slice(0, 5),
        }
      }

      return { success: true, message: `${permits?.length || 0} permits verified` }
    }),
  ])

  checks.push(...workflowChecks)

  // Summary
  const passed = checks.filter((c) => c.status === "pass").length
  const failed = checks.filter((c) => c.status === "fail").length
  const warnings = checks.filter((c) => c.status === "warn").length

  return NextResponse.json({
    timestamp: new Date().toISOString(),
    summary: {
      total: checks.length,
      passed,
      failed,
      warnings,
      healthy: failed === 0,
    },
    checks,
  })
}
