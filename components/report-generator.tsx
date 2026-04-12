"use client"

import { useState, useRef } from "react"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Checkbox } from "@/components/ui/checkbox"
import { Label } from "@/components/ui/label"
import { Input } from "@/components/ui/input"
import { FileDown, Loader2, Printer, Download, Package, TrendingDown, AlertTriangle, FileText } from "lucide-react"
import { useAppContext } from "@/lib/app-context"
import type { UserRole } from "@/lib/types"
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select"

type ReportType = "sales" | "purchase" | "inventory" | "financial" | "customers" | "suppliers" | "lost-sales"

interface ReportGeneratorProps {
  type: ReportType
  userRole: UserRole
}

type PresetTemplate = {
  name: string
  description: string
  fields: string[]
  filter?: (data: any[]) => any[]
  groupBy?: string // Added for lost-sales template
  groupBy2?: string // Added for lost-sales template
  groupBy3?: string // Added for lost-sales template
}

interface FieldConfig {
  key: string
  label: string
}

export function ReportGenerator({ type, userRole }: ReportGeneratorProps) {
  const {
    salesOrders: salesData, // Renamed to avoid conflict with salesOrders being used elsewhere potentially
    customers: customersData, // Renamed to avoid conflict
    products,
    inventory,
    purchaseOrders,
    suppliers,
    customerInvoices,
    supplierInvoices,
    customerPayments,
    supplierPayments,
    prepaidBalance,
    accountsReceivable,
    accountsPayable,
  } = useAppContext()

  const [open, setOpen] = useState(false)
  const [generating, setGenerating] = useState(false)
  const [selectedFields, setSelectedFields] = useState<string[]>([])
  const [format, setFormat] = useState<"pdf" | "csv">("pdf")
  const [fromDate, setFromDate] = useState<string>("")
  const [toDate, setToDate] = useState<string>("")
  const [selectedPreset, setSelectedPreset] = useState<string | null>(null)
  const [categoryFilter, setCategoryFilter] = useState<string>("all")
  const [groupBy, setGroupBy] = useState<string>("none")
  const [groupBy2, setGroupBy2] = useState<string>("none")
  const [groupBy3, setGroupBy3] = useState<string>("none")
  const [reportPreview, setReportPreview] = useState<{ open: boolean; html: string; title: string }>({
    open: false,
    html: "",
    title: "",
  })
  const iframeRef = useRef<HTMLIFrameElement>(null)

  if (!type) {
    return null
  }

  const isOverdue = (invoice: any) => {
    if (invoice.status === "paid") return false

    const today = new Date()
    today.setHours(0, 0, 0, 0)

    const effectiveDueDate = new Date(invoice.dueDate)

    // If installments, add monthsPaid to the original due date to get the next due date
    if (invoice.installmentMonths > 0) {
      effectiveDueDate.setMonth(effectiveDueDate.getMonth() + (invoice.monthsPaid || 0))
    }

    return effectiveDueDate < today
  }

  const presetTemplates: Record<ReportType, PresetTemplate[]> = {
    inventory: [
      {
        name: "Low Stock Alert",
        description: "Items below reorder point that need restocking",
        fields: ["productName", "sku", "category", "quantity", "reorderPoint", "unitCost", "location"],
        filter: (items) => items.filter((item: any) => item.quantity <= item.reorderPoint),
      },
      {
        name: "High Value Items",
        description: "Top 20 most valuable inventory items",
        fields: ["productName", "quantity", "unitCost", "totalValue"],
        filter: (items) => items.sort((a: any, b: any) => b.totalValueRaw - a.totalValueRaw).slice(0, 20),
      },
      {
        name: "Stock Valuation",
        description: "Complete inventory with total value",
        fields: ["productName", "category", "quantity", "unitCost", "totalValue"],
      },
      {
        name: "Zero Stock Items",
        description: "Out of stock items requiring immediate attention",
        fields: ["productName", "sku", "reorderPoint", "location"],
        filter: (items) => items.filter((item: any) => item.quantity === 0),
      },
      {
        name: "Pumps Only",
        description: "All pump products in inventory",
        fields: ["productName", "sku", "quantity", "unitCost", "totalValue", "location"],
        filter: (items) => items.filter((item: any) => item.category === "pumps"),
      },
      {
        name: "Auto Equipment Only",
        description: "All auto equipment in inventory",
        fields: ["productName", "sku", "quantity", "unitCost", "totalValue", "location"],
        filter: (items) => items.filter((item: any) => item.category === "auto equipment"),
      },
    ],
    sales: [
      {
        name: "Top Customers",
        description: "Top 10 customers by total order value",
        fields: ["customerName", "total", "orderDate", "status"],
        filter: (orders) => {
          const customerTotals = orders.reduce((acc: any, order: any) => {
            acc[order.customerName] = (acc[order.customerName] || 0) + order.totalRaw
            return acc
          }, {})
          return orders
            .sort((a: any, b: any) => (customerTotals[b.customerName] || 0) - (customerTotals[a.customerName] || 0))
            .slice(0, 10)
        },
      },
      {
        name: "Pending Orders",
        description: "Sales orders awaiting approval or processing",
        fields: ["soNumber", "customerName", "orderDate", "total", "status"],
        filter: (orders) =>
          orders.filter((order: any) => order.statusRaw === "pending_ceo" || order.statusRaw === "pending_accountant"),
      },
      {
        name: "Installment Sales",
        description: "All sales with installment payment plans",
        fields: ["soNumber", "customerName", "total", "paymentTerms", "installments", "status"],
        filter: (orders) => {
          const filtered = orders.filter(
            (order: any) =>
              order.paymentTerms?.toLowerCase() === "installment" ||
              order.paymentTerms?.toLowerCase() === "installments" ||
              (order.installments && Number(order.installments) > 1),
          )
          console.log("[v0] Installment filter:", {
            total: orders.length,
            filtered: filtered.length,
            sample: filtered[0],
          })
          return filtered
        },
      },
      {
        name: "Monthly Sales Summary",
        description: "Sales grouped by month with totals",
        fields: ["soNumber", "customerName", "orderDate", "total", "status"],
      },
      {
        name: "All Sales Orders",
        description: "Complete list of all sales orders",
        fields: ["soNumber", "customerName", "orderDate", "total", "paymentTerms", "status"],
        filter: undefined, // No filter - shows all
      },
    ],
    purchase: [
      {
        name: "Reorder Needed (by Category)",
        description: "Items low in stock or about to run low, grouped by category",
        fields: ["category", "productName", "sku", "quantity", "reorderPoint", "stockStatus", "unitCost", "location"],
        filter: (items) => {
          // Filter items that are at or below reorder point, or within 20% of reorder point
          return items
            .filter((item: any) => {
              const qty = Number(item.quantity || 0)
              const reorderPoint = Number(item.reorderPoint || 0)
              // Include if: quantity <= reorder point OR quantity is within 20% above reorder point
              return qty <= reorderPoint || qty <= reorderPoint * 1.2
            })
            .sort((a: any, b: any) => {
              // Sort by category first, then by urgency (quantity relative to reorder point)
              if (a.category !== b.category) {
                return (a.category || "").localeCompare(b.category || "")
              }
              // More urgent items (lower stock relative to reorder) first
              const aUrgency = Number(a.quantity || 0) / Math.max(Number(a.reorderPoint || 1), 1)
              const bUrgency = Number(b.quantity || 0) / Math.max(Number(b.reorderPoint || 1), 1)
              return aUrgency - bUrgency
            })
        },
      },
      {
        name: "Critical Stock (Out of Stock)",
        description: "Items with zero stock - urgent reorder needed",
        fields: ["category", "productName", "sku", "reorderPoint", "unitCost", "location"],
        filter: (items) =>
          items
            .filter((item: any) => Number(item.quantity || 0) === 0)
            .sort((a: any, b: any) => (a.category || "").localeCompare(b.category || "")),
      },
      {
        name: "Low Stock by Category",
        description: "Items below reorder point, organized by product category",
        fields: ["category", "productName", "sku", "quantity", "reorderPoint", "unitCost", "totalValue"],
        filter: (items) =>
          items
            .filter((item: any) => Number(item.quantity || 0) <= Number(item.reorderPoint || 0))
            .sort((a: any, b: any) => (a.category || "").localeCompare(b.category || "")),
      },
      {
        name: "Pending Approvals",
        description: "Purchase orders awaiting CEO approval",
        fields: ["poNumber", "supplierName", "orderDate", "total", "status"],
        filter: (orders) => orders.filter((order: any) => order.statusRaw === "pending_ceo"),
      },
      {
        name: "Top Suppliers",
        description: "Top 10 suppliers by total purchase value",
        fields: ["supplierName", "total", "orderDate", "status"],
        filter: (orders) => {
          const supplierTotals = orders.reduce((acc: any, order: any) => {
            acc[order.supplierName] = (acc[order.supplierName] || 0) + order.totalRaw
            return acc
          }, {})
          return orders
            .sort((a: any, b: any) => (supplierTotals[b.supplierName] || 0) - (supplierTotals[a.supplierName] || 0))
            .slice(0, 10)
        },
      },
      {
        name: "Approved Orders",
        description: "Purchase orders approved and ready for processing",
        fields: ["poNumber", "supplierName", "orderDate", "total", "items"],
        filter: (orders) => orders.filter((order: any) => order.statusRaw === "approved"),
      },
    ],
    financial: [
      {
        name: "Cash Flow Summary",
        description: "Income vs expenses overview",
        fields: ["balance", "totalSales", "totalPurchases", "prepaidBalance"],
      },
      {
        name: "AR Aging Report",
        description: "Outstanding customer receivables",
        fields: ["arOutstanding", "customerPayments", "totalSales"],
      },
      {
        name: "AP Aging Report",
        description: "Outstanding supplier payables",
        fields: ["apOutstanding", "supplierPayments", "totalPurchases"],
      },
    ],
    customers: [
      {
        name: "Top Spending Customers",
        description: "Top 10 customers by total spending",
        fields: ["name", "email", "phone", "city", "totalOrders", "totalSpent"],
        filter: (customers) =>
          customers
            .sort((a: any, b: any) => {
              const aSpent = Number.parseFloat(a.totalSpent.replace(/[$,]/g, ""))
              const bSpent = Number.parseFloat(b.totalSpent.replace(/[$,]/g, ""))
              return bSpent - aSpent
            })
            .slice(0, 10),
      },
      {
        name: "Active Customers",
        description: "Customers with at least one order",
        fields: ["name", "email", "phone", "city", "totalOrders", "totalSpent"],
        filter: (customers) => customers.filter((c: any) => c.totalOrders > 0),
      },
      {
        name: "Overdue Receivables",
        description: "Customers with overdue payments",
        fields: ["name", "phone", "totalOverdue", "totalSpent"],
        filter: (customers) =>
          customers.filter((c: any) => {
            const overdue = Number.parseFloat(c.totalOverdue.replace(/[$,]/g, ""))
            return overdue > 0
          }),
      },
      {
        name: "Customer Directory",
        description: "Complete customer contact information",
        fields: ["name", "email", "phone", "address", "city", "country"],
      },
    ],
    suppliers: [
      {
        name: "Top Suppliers",
        description: "Top 10 suppliers by total purchase value",
        fields: ["name", "email", "phone", "totalOrders", "totalAmount"],
        filter: (suppliers) =>
          suppliers
            .sort((a: any, b: any) => {
              const aAmount = Number.parseFloat(a.totalAmount.replace(/[$,]/g, ""))
              const bAmount = Number.parseFloat(b.totalAmount.replace(/[$,]/g, ""))
              return bAmount - aAmount
            })
            .slice(0, 10),
      },
      {
        name: "Active Suppliers",
        description: "Suppliers with at least one purchase order",
        fields: ["name", "email", "phone", "city", "totalOrders", "totalAmount"],
        filter: (suppliers) => suppliers.filter((s: any) => s.totalOrders > 0),
      },
      {
        name: "Overdue Payables",
        description: "Suppliers with overdue payments",
        fields: ["name", "phone", "totalOverdue", "totalAmount"],
        filter: (suppliers) =>
          suppliers.filter((s: any) => {
            const overdue = Number.parseFloat(s.totalOverdue.replace(/[$,]/g, ""))
            return overdue > 0
          }),
      },
      {
        name: "Supplier Directory",
        description: "Complete supplier contact information",
        fields: ["name", "email", "phone", "address", "city", "country"],
      },
    ],
    // Simplified lost-sales presets
    "lost-sales": [
      {
        name: "All Lost Sales",
        description: "Complete list of all lost sale requests",
        fields: [
          "requestDate",
          "requestedItemName",
          "customerName",
          "requestedQuantity",
          "customerEmail",
          "customerPhone",
        ],
      },
      {
        name: "By Product",
        description: "Lost sales grouped by product name",
        fields: [
          "requestedItemName",
          "customerName",
          "requestedQuantity",
          "requestDate",
          "customerEmail",
          "customerPhone",
        ],
        groupBy: "requestedItemName",
        // Removed groupBy2 and groupBy3 for simpler single-level grouping
      },
      {
        name: "By Month",
        description: "Lost sales grouped by month",
        fields: ["month", "totalRequests", "totalQuantity", "uniqueCustomers"],
      },
      {
        name: "Top Requested Items",
        description: "Most frequently requested items",
        fields: ["requestedItemName", "requestCount", "totalQuantity"],
      },
    ],
  }

  const reportFields: Record<ReportType, FieldConfig[]> = {
    sales: [
      { label: "Sales Order Number", key: "soNumber" },
      { label: "Customer Name", key: "customerName" },
      { label: "Order Date", key: "orderDate" },
      { label: "Total Amount", key: "total" },
      { label: "Payment Method", key: "paymentTerms" },
      { label: "Status", key: "status" },
      { label: "Items Details", key: "items" },
      { label: "Installment Info", key: "installments" },
    ],
    inventory: [
      { label: "Product Name", key: "productName" },
      { label: "SKU", key: "sku" },
      { label: "Category", key: "category" },
      { label: "Quantity", key: "quantity" },
      { label: "Unit Cost", key: "unitCost" },
      { label: "Total Value", key: "totalValue" },
      { label: "Reorder Point", key: "reorderPoint" },
      { label: "Location", key: "location" },
    ],
    purchase: [
      { label: "PO Number", key: "poNumber" },
      { label: "Supplier Name", key: "supplierName" },
      { label: "Order Date", key: "orderDate" },
      { label: "Total Amount", key: "total" },
      { label: "Payment Method", key: "paymentTerms" },
      { label: "Status", key: "status" },
      { label: "Items Details", key: "items" },
      { label: "Currency", key: "currency" },
    ],
    financial: [
      { label: "Current Balance", key: "balance" },
      { label: "Total Sales", key: "totalSales" },
      { label: "Total Purchases", key: "totalPurchases" },
      { label: "AR Outstanding", key: "arOutstanding" },
      { label: "AP Outstanding", key: "apOutstanding" },
      { label: "Prepaid Balance", key: "prepaidBalance" },
      { label: "Customer Payments", key: "customerPayments" },
      { label: "Supplier Payments", key: "supplierPayments" },
    ],
    customers: [
      { label: "Customer Name", key: "name" },
      { label: "Email", key: "email" },
      { label: "Phone", key: "phone" },
      { label: "Address", key: "address" },
      { label: "City", key: "city" },
      { label: "Country", key: "country" },
      { label: "Total Orders", key: "totalOrders" },
      { label: "Total Spent", key: "totalSpent" },
      { label: "Overdue Balance", key: "totalOverdue" },
    ],
    suppliers: [
      { label: "Supplier Name", key: "name" },
      { label: "Email", key: "email" },
      { label: "Phone", key: "phone" },
      { label: "Address", key: "address" },
      { label: "City", key: "city" },
      { label: "Country", key: "country" },
      { label: "Total Orders", key: "totalOrders" },
      { label: "Total Amount", key: "totalAmount" },
      { label: "Overdue Balance", key: "totalOverdue" },
    ],
    // Simplified lost-sales fields
    "lost-sales": [
      { label: "Date", key: "requestDate" },
      { label: "Product Name", key: "requestedItemName" },
      { label: "Customer Name", key: "customerName" },
      { label: "Quantity", key: "requestedQuantity" },
      { label: "Email", key: "customerEmail" },
      { label: "Phone", key: "customerPhone" },
      // Summary fields
      { label: "Month", key: "month" },
      { label: "Total Requests", key: "totalRequests" },
      { label: "Total Quantity", key: "totalQuantity" },
      { label: "Unique Customers", key: "uniqueCustomers" },
      // Top items fields
      { label: "Request Count", key: "requestCount" },
      // Grouping fields for "By Product, Customer & Quantity" preset
      { label: "Product Name", key: "requestedItemName" },
      { label: "Customer Name", key: "customerName" },
      { label: "Quantity", key: "requestedQuantity" },
    ],
  }

  const applyPreset = (presetName: string) => {
    const preset = presetTemplates[type].find((p) => p.name === presetName)
    if (preset) {
      setSelectedPreset(presetName)
      setSelectedFields(preset.fields)
      // Set group by fields if available in the preset
      setGroupBy(preset.groupBy || "none")
      setGroupBy2(preset.groupBy2 || "none")
      setGroupBy3(preset.groupBy3 || "none")
    }
  }

  const handleFieldToggle = (field: string) => {
    setSelectedPreset(null) // Clear preset when manually toggling
    setSelectedFields((prev) => (prev.includes(field) ? prev.filter((f) => f !== field) : [...prev, field]))
  }

  const handleSelectAll = () => {
    setSelectedPreset(null) // Clear preset
    if (selectedFields.length === reportFields[type].length) {
      setSelectedFields([])
    } else {
      setSelectedFields(reportFields[type].map((f) => f.key))
    }
  }

  // Helper function to filter data by date range
  const filterByDateRange = (data: any[], dateField: string) => {
    if (!fromDate && !toDate) return data

    return data.filter((item) => {
      const itemDate = new Date(item[dateField])
      const from = fromDate ? new Date(fromDate) : null
      const to = toDate ? new Date(toDate) : null

      // Ensure dates are set to the start of the day for consistent comparison
      itemDate.setHours(0, 0, 0, 0)
      if (from) from.setHours(0, 0, 0, 0)
      if (to) to.setHours(0, 0, 0, 0)

      const isAfterFrom = from ? itemDate >= from : true
      const isBeforeTo = to ? itemDate <= to : true

      return isAfterFrom && isBeforeTo
    })
  }

  const transformDatabaseData = (rawData: any[], reportSubType: string): any[] => {
    switch (type) {
      case "sales":
        return rawData.map((row) => ({
          soNumber: row.so_number,
          customerName: row.customer_name || "Unknown",
          orderDate: row.order_date,
          total: `$${Number(row.total || 0).toLocaleString()}`,
          totalRaw: Number(row.total || 0),
          statusRaw: row.status,
          paymentTerms: row.payment_terms,
          status: row.status,
          items: "See details",
          installments: row.installments ? `${row.installments} months` : "N/A",
          // Additional fields from specific queries
          month: row.month,
          total_orders: row.total_orders,
          completed_orders: row.completed_orders,
          pending_orders: row.pending_orders,
          total_revenue:
            row.total_revenue !== undefined ? `$${Number(row.total_revenue || 0).toLocaleString()}` : undefined,
          avg_order_value:
            row.avg_order_value !== undefined ? `$${Number(row.avg_order_value || 0).toLocaleString()}` : undefined,
          unique_customers: row.unique_customers,
          customer_email: row.customer_email,
          customer_phone: row.customer_phone,
          customer_city: row.customer_city,
          customer_country: row.customer_country,
          productName: row.product_name,
          sku: row.sku,
          category: row.category,
          total_sold: row.total_sold,
          order_count: row.order_count,
          customer_count: row.customer_count,
        }))

      case "purchase":
        return rawData.map((row) => ({
          poNumber: row.po_number,
          supplierName: row.supplier_name || "Unknown",
          orderDate: row.order_date,
          total: `$${Number(row.total || 0).toLocaleString()}`,
          totalRaw: Number(row.total || 0),
          statusRaw: row.status,
          paymentTerms: row.payment_terms,
          status: row.status,
          items: "See details",
          currency: row.currency || "USD",
          tax_amount: row.tax_amount !== undefined ? `$${Number(row.tax_amount || 0).toLocaleString()}` : undefined,
          other_costs: row.other_costs !== undefined ? `$${Number(row.other_costs || 0).toLocaleString()}` : undefined,
          total_amount:
            row.total_amount !== undefined ? `$${Number(row.total_amount || 0).toLocaleString()}` : undefined,
          total_tax: row.total_tax !== undefined ? `$${Number(row.total_tax || 0).toLocaleString()}` : undefined,
          total_other_costs:
            row.total_other_costs !== undefined ? `$${Number(row.total_other_costs || 0).toLocaleString()}` : undefined,
          avg_order_value:
            row.avg_order_value !== undefined ? `$${Number(row.avg_order_value || 0).toLocaleString()}` : undefined,
          unique_suppliers: row.unique_suppliers,
          supplier_email: row.supplier_email,
          supplier_phone: row.supplier_phone,
          supplier_city: row.supplier_city,
          supplier_country: row.supplier_country,
          lead_time_days: row.lead_time_days,
        }))

      case "inventory":
        return rawData.map((row) => ({
          productName: row.productName || row.product_name || row.sku || "Unknown Product",
          sku: row.sku || row.sku || "",
          category: row.category || row.category || "Uncategorized",
          quantity: row.quantity,
          unitCost: `$${Number(row.unitCost || row.unit_cost || 0).toLocaleString()}`,
          totalValue: `$${Number(row.totalValue || row.total_value || 0).toLocaleString()}`,
          totalValueRaw: Number(row.totalValue || row.total_value || 0),
          reorderPoint: row.reorderPoint || row.reorder_point || 0,
          location: row.location || "Main",
          stockStatus: row.stockStatus,
          // Fields for inventory reports
          unit_price: row.unit_price !== undefined ? `$${Number(row.unit_price || 0).toLocaleString()}` : undefined,
          last_landed_cost:
            row.last_landed_cost !== undefined ? `$${Number(row.last_landed_cost || 0).toLocaleString()}` : undefined,
          markup_percentage: row.markup_percentage,
          total_quantity_sold: row.total_quantity_sold,
          total_revenue:
            row.total_revenue !== undefined ? `$${Number(row.total_revenue || 0).toLocaleString()}` : undefined,
          order_count: row.order_count,
          profit_margin_pct: row.profit_margin_pct,
          // Fields for other inventory queries (summaries etc.)
          total_products: row.total_products,
          total_quantity: row.total_quantity,
          avg_unit_cost:
            row.avg_unit_cost !== undefined ? `$${Number(row.avg_unit_cost || 0).toLocaleString()}` : undefined,
          low_stock_count: row.low_stock_count,
          out_of_stock_count: row.out_of_stock_count,
          current_stock: row.current_stock,
        }))

      case "financial":
        return rawData.map((row) => ({
          balance: `$${Number(row.gross_profit || 0).toLocaleString()}`,
          totalSales: `$${Number(row.total_revenue || 0).toLocaleString()}`,
          totalPurchases: `$${Number(row.total_expenses || 0).toLocaleString()}`,
          arOutstanding: `$${Number(row.ar_outstanding || 0).toLocaleString()}`,
          apOutstanding: `$${Number(row.ap_outstanding || 0).toLocaleString()}`,
          prepaidBalance: `$${Number(row.inventory_value || 0).toLocaleString()}`,
          customerPayments: row.total_customers || 0,
          supplierPayments: row.total_suppliers || 0,
          total_inflow:
            row.total_inflow !== undefined ? `$${Number(row.total_inflow || 0).toLocaleString()}` : undefined,
          total_outflow:
            row.total_outflow !== undefined ? `$${Number(row.total_outflow || 0).toLocaleString()}` : undefined,
          net_cash_flow:
            row.net_cash_flow !== undefined ? `$${Number(row.net_cash_flow || 0).toLocaleString()}` : undefined,
          transaction_count: row.transaction_count,
          invoice_id: row.invoice_id,
          invoice_number: row.invoice_number,
          invoice_date: row.invoice_date,
          due_date: row.due_date,
          total_amount:
            row.total_amount !== undefined ? `$${Number(row.total_amount || 0).toLocaleString()}` : undefined,
          paid_amount: row.paid_amount !== undefined ? `$${Number(row.paid_amount || 0).toLocaleString()}` : undefined,
          balance_due: row.balance_due !== undefined ? `$${Number(row.balance_due || 0).toLocaleString()}` : undefined,
          payment_terms: row.payment_terms,
          installment_months: row.installment_months,
          months_paid: row.months_paid,
          days_overdue: row.days_overdue,
          aging_bucket: row.aging_bucket,
          customer_name: row.customer_name,
          customer_email: row.customer_email,
          customer_phone: row.customer_phone,
          supplier_name: row.supplier_name,
          supplier_email: row.supplier_email,
          supplier_phone: row.supplier_phone,
          total_sales_orders: row.total_sales_orders,
          total_purchase_orders: row.total_purchase_orders,
          total_customers: row.total_customers,
          total_suppliers: row.total_suppliers,
          inventory_value:
            row.inventory_value !== undefined ? `$${Number(row.inventory_value || 0).toLocaleString()}` : undefined,
        }))

      case "customers":
        return rawData.map((row) => ({
          name: row.customer_name,
          email: row.email,
          phone: `${row.country_code || ""} ${row.phone || ""}`.trim(),
          address: row.address || "N/A",
          city: row.city || "N/A",
          country: row.country || "N/A",
          totalOrders: row.total_orders || 0,
          totalSpent: `$${Number(row.total_spent || 0).toLocaleString()}`,
          totalOverdue:
            row.overdue_amount !== undefined ? `$${Number(row.overdue_amount || 0).toLocaleString()}` : "$0", // Use overdue_amount from DB query
          payment_terms: row.payment_terms,
          credit_limit:
            row.credit_limit !== undefined ? `$${Number(row.credit_limit || 0).toLocaleString()}` : undefined,
          created_at: row.created_at,
          invoice_count: row.invoice_count,
          total_invoiced:
            row.total_invoiced !== undefined ? `$${Number(row.total_invoiced || 0).toLocaleString()}` : undefined,
          total_collected:
            row.total_collected !== undefined ? `$${Number(row.total_collected || 0).toLocaleString()}` : undefined,
          total_outstanding:
            row.total_outstanding !== undefined ? `$${Number(row.total_outstanding || 0).toLocaleString()}` : undefined,
          avg_order_value:
            row.avg_order_value !== undefined ? `$${Number(row.avg_order_value || 0).toLocaleString()}` : undefined,
          last_order_date: row.last_order_date,
        }))

      case "suppliers":
        return rawData.map((row) => ({
          name: row.supplier_name,
          email: row.email,
          phone: `${row.country_code || ""} ${row.phone || ""}`.trim(),
          address: row.address || "N/A",
          city: row.city || "N/A",
          country: row.country || "N/A",
          totalOrders: row.total_orders || 0,
          totalAmount: `$${Number(row.total_amount || 0).toLocaleString()}`,
          totalOverdue:
            row.overdue_amount !== undefined ? `$${Number(row.overdue_amount || 0).toLocaleString()}` : "$0", // Use overdue_amount from DB query
          payment_terms: row.payment_terms,
          lead_time_days: row.lead_time_days,
          created_at: row.created_at,
          invoice_count: row.invoice_count,
          total_invoiced:
            row.total_invoiced !== undefined ? `$${Number(row.total_invoiced || 0).toLocaleString()}` : undefined,
          total_paid: row.total_paid !== undefined ? `$${Number(row.total_paid || 0).toLocaleString()}` : undefined,
          total_outstanding:
            row.total_outstanding !== undefined ? `$${Number(row.total_outstanding || 0).toLocaleString()}` : undefined,
          avg_order_value:
            row.avg_order_value !== undefined ? `$${Number(row.avg_order_value || 0).toLocaleString()}` : undefined,
          last_order_date: row.last_order_date,
        }))

      case "lost-sales":
        return rawData.map((row) => ({
          // Fields corresponding to the simplified schema
          requestDate: row.request_date,
          requestedItemName: row.requested_item_name,
          customerName: row.customer_name || "-",
          requestedQuantity: row.requested_quantity || 1,
          customerEmail: row.customer_email || "-",
          customerPhone: row.customer_phone || "-",
          // Summary fields
          month: row.month,
          totalRequests: row.total_requests,
          totalQuantity: row.total_quantity,
          uniqueCustomers: row.unique_customers,
          // Top items fields
          requestCount: row.request_count,
        }))

      default:
        return rawData
    }
  }

  // Helper function to group data
  const groupData = (data: any[], groupByFields: string[]): any => {
    const normalizeValue = (value: any, field: string) => {
      // Check if the field name suggests it's a date field
      const isDateField = field.toLowerCase().includes("date") || field.toLowerCase().includes("time")

      if (isDateField && value) {
        try {
          const date = new Date(value)
          if (!isNaN(date.getTime())) {
            // Return date as YYYY-MM-DD format for consistent grouping
            return date.toLocaleDateString("en-CA") // en-CA gives YYYY-MM-DD format
          }
        } catch (e) {
          // If date parsing fails, return original value
        }
      }

      if (typeof value === "string") {
        return value.trim() || "Uncategorized"
      }

      return value || "Uncategorized"
    }

    const grouped: any = {}

    data.forEach((item) => {
      let currentLevel = grouped
      for (let i = 0; i < groupByFields.length; i++) {
        const field = groupByFields[i]
        if (field === "none") continue

        const key = normalizeValue(item[field], field)

        if (i === groupByFields.length - 1) {
          // Last level, push the item
          if (!currentLevel[key]) {
            currentLevel[key] = []
          }
          currentLevel[key].push(item)
        } else {
          // Intermediate level, create nested object
          if (!currentLevel[key]) {
            currentLevel[key] = {}
          }
          currentLevel = currentLevel[key]
        }
      }
    })
    return grouped
  }

  const generatePDF = async (
    processedData: any,
    title: string,
    selectedFieldsConfig: FieldConfig[],
    groupByFields: string[],
    dateRange?: { startDate?: string; endDate?: string },
  ) => {
    try {
      console.log("[v0] generatePDF called with:", {
        title,
        groupingLevel: groupByFields.filter((f) => f !== "none").length,
        dataType: typeof processedData,
        isArray: Array.isArray(processedData),
        dateRange,
      })

      const groupingLevel = groupByFields.filter((f) => f !== "none").length
      let dataToRender = processedData

      // The processedData is already grouped if groupingLevel > 0,
      // so we only need to check if it's an array for renderTable
      if (groupingLevel > 0 && typeof processedData !== "object") {
        console.warn("[v0] Expected object for grouped data, but received:", typeof processedData)
        dataToRender = [] // Fallback to empty array if structure is unexpected
      } else if (Array.isArray(processedData) && groupingLevel > 0) {
        console.warn("[v0] Expected object for grouped data, but received array. Treating as flat data.")
        dataToRender = processedData
      }

      const renderTable = (items: any[], showTotals = false, groupedFields: string[] = []) => {
        try {
          const fieldsToShow = selectedFieldsConfig.filter((field) => !groupedFields.includes(field.key))

          console.log("[v0] renderTable called with:", {
            itemCount: items?.length,
            firstItem: items?.[0],
            fieldsToShow: fieldsToShow.map((f) => ({ key: f.key, label: f.label })),
            groupedFields,
          })

          if (!Array.isArray(items) || items.length === 0) {
            return '<div class="no-data">No data available</div>'
          }

          const headers = fieldsToShow.map((f) => f.label).join("</th><th>")
          const rows = items
            .map((item, idx) => {
              const cells = fieldsToShow
                .map((field) => {
                  let val = item[field.key]

                  if (idx === 0) {
                    console.log(`[v0] Field ${field.key}:`, val)
                  }

                  if (val === null || val === undefined) return "-"
                  if (field.key.toLowerCase().includes("date") && val) {
                    const dateVal = new Date(val)
                    if (!isNaN(dateVal.getTime())) {
                      val = dateVal.toLocaleDateString()
                    }
                  }
                  if (typeof val === "number") {
                    val = val.toLocaleString()
                  }
                  // Handle currency values more robustly for display
                  if (typeof val === "string" && val.startsWith("$")) {
                    // Try to parse and format if it looks like currency
                    const numericVal = Number.parseFloat(val.replace(/[$,]/g, ""))
                    if (!isNaN(numericVal)) {
                      val = `$${numericVal.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
                    }
                  } else if (typeof val === "number" && !isNaN(val)) {
                    // Check if the field name suggests it's a currency field
                    const isCurrencyField =
                      field.key.toLowerCase().includes("amount") ||
                      field.key.toLowerCase().includes("total") ||
                      field.key.toLowerCase().includes("price") ||
                      field.key.toLowerCase().includes("cost") ||
                      field.key.toLowerCase().includes("revenue") ||
                      field.key.toLowerCase().includes("balance") ||
                      field.key.toLowerCase().includes("paid") ||
                      field.key.toLowerCase().includes("spent") ||
                      field.key.toLowerCase().includes("credit_limit") ||
                      field.key.toLowerCase().includes("inventory_value") ||
                      field.key.toLowerCase().includes("outstanding") ||
                      field.key.toLowerCase().includes("overdue") ||
                      field.key.toLowerCase().includes("value")
                    if (isCurrencyField) {
                      val = `$${val.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
                    } else {
                      val = val.toLocaleString()
                    }
                  }
                  return val
                })
                .join("</td><td>")
              return `<tr><td>${cells}</td></tr>`
            })
            .join("")

          let totalRow = ""
          if (showTotals && items.length > 0) {
            const totals = fieldsToShow.map((field, idx) => {
              // Only calculate totals for numeric fields
              const isNumericField =
                field.key.toLowerCase().includes("quantity") ||
                field.key.toLowerCase().includes("amount") ||
                field.key.toLowerCase().includes("total") ||
                field.key.toLowerCase().includes("price") ||
                field.key.toLowerCase().includes("cost") ||
                field.key.toLowerCase().includes("revenue") ||
                field.key.toLowerCase().includes("balance") ||
                field.key.toLowerCase().includes("paid") ||
                field.key.toLowerCase().includes("spent") ||
                field.key.toLowerCase().includes("credit_limit") ||
                field.key.toLowerCase().includes("inventory_value") ||
                field.key.toLowerCase().includes("outstanding") ||
                field.key.toLowerCase().includes("overdue") ||
                field.key.toLowerCase().includes("value") ||
                field.key.toLowerCase().includes("count") // Include count for totals

              if (!isNumericField) {
                return "" // Return empty string for non-numeric fields
              }

              const numericValues = items
                .map((item) => {
                  const val = item[field.key]
                  let numVal = val
                  if (typeof val === "string") {
                    numVal = Number.parseFloat(val.replace(/[$,]/g, ""))
                  } else if (typeof val !== "number") {
                    return Number.NaN // Return NaN if not a number or string representation of number
                  }
                  return Number(numVal)
                })
                .filter((v) => !isNaN(v)) // Filter out NaN values

              if (numericValues.length > 0) {
                const sum = numericValues.reduce((a, b) => a + b, 0)
                const isCurrencyField =
                  field.key.toLowerCase().includes("amount") ||
                  field.key.toLowerCase().includes("total") ||
                  field.key.toLowerCase().includes("price") ||
                  field.key.toLowerCase().includes("cost") ||
                  field.key.toLowerCase().includes("revenue") ||
                  field.key.toLowerCase().includes("balance") ||
                  field.key.toLowerCase().includes("paid") ||
                  field.key.toLowerCase().includes("spent") ||
                  field.key.toLowerCase().includes("credit_limit") ||
                  field.key.toLowerCase().includes("inventory_value") ||
                  field.key.toLowerCase().includes("outstanding") ||
                  field.key.toLowerCase().includes("overdue") ||
                  field.key.toLowerCase().includes("value")
                if (isCurrencyField) {
                  return `<strong>$${sum.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</strong>`
                }
                return `<strong>${sum.toLocaleString()}</strong>`
              }
              return "" // Return empty string if no numeric values found
            })
            totalRow = `<tr class="total-row"><td>${totals.join("</td><td>")}</td></tr>`
          }

          return `
        <table>
          <thead>
            <tr><th>${headers}</th></tr>
          </thead>
          <tbody>
            ${rows}
            ${totalRow}
          </tbody>
        </table>
      `
        } catch (error) {
          console.error("[v0] Error in renderTable:", error)
          return '<div class="no-data">Error rendering table</div>'
        }
      }

      const renderContent = () => {
        try {
          let content = ""
          const renderLevel = (data: any, level: number, currentGroupedFields: string[] = []) => {
            try {
              let currentContent = ""
              const groupKeys = Object.keys(data)

              const groupFieldForLevel = groupByFields[level] || ""
              const allGroupedFieldsUpToHere = [...currentGroupedFields, groupFieldForLevel].filter(
                (f) => f && f !== "none",
              )

              if (level === groupingLevel) {
                currentContent += renderTable(data as any[], true, allGroupedFieldsUpToHere)
              } else {
                groupKeys.forEach((key) => {
                  const headerTag = `h${Math.min(level + 2, 4)}`
                  const itemCount = Array.isArray(data[key]) ? data[key].length : Object.keys(data[key]).length

                  const groupFieldLabel =
                    selectedFieldsConfig.find((f) => f.key === groupFieldForLevel)?.label || groupFieldForLevel

                  currentContent += `<${headerTag}>${groupFieldLabel}: ${key} (${itemCount} items)</${headerTag}>`

                  currentContent += renderLevel(data[key], level + 1, allGroupedFieldsUpToHere)
                })
              }
              return currentContent
            } catch (error) {
              console.error("[v0] Error in renderLevel:", error)
              return '<div class="no-data">Error rendering grouped content</div>'
            }
          }

          if (groupingLevel > 0 && typeof dataToRender === "object" && !Array.isArray(dataToRender)) {
            content += renderLevel(dataToRender, 0, [])
          } else if (Array.isArray(dataToRender)) {
            content += renderTable(dataToRender, false, []) // Pass empty array for groupedFields when data is flat
          } else {
            content = '<div class="no-data">No data or unexpected data format.</div>'
          }

          return content
        } catch (error) {
          console.error("[v0] Error in renderContent:", error)
          return '<div class="no-data">Error rendering report content</div>'
        }
      }

      console.log("[v0] Starting HTML generation...")
      const htmlContent = `
      <!DOCTYPE html>
      <html>
        <head>
          <meta charset="UTF-8">
          <title>${title}</title>
          <style>
            * {
              margin: 0;
              padding: 0;
              box-sizing: border-box;
            }
            body {
              font-family: Arial, sans-serif;
              padding: 30px;
              font-size: 12px;
              line-height: 1.4;
              color: #000;
              background: #fff;
            }
            .header {
              border-bottom: 2px solid #000;
              padding-bottom: 15px;
              margin-bottom: 25px;
            }
            h1 {
              font-size: 20px;
              font-weight: bold;
              margin-bottom: 5px;
            }
            .date {
              font-size: 11px;
              color: #666;
            }
            .content-wrapper {
              /* Simple wrapper, no styling */
            }
            h2 {
              font-size: 16px;
              font-weight: bold;
              margin-top: 25px;
              margin-bottom: 12px;
              padding-bottom: 5px;
              border-bottom: 1px solid #000;
            }
            h2:first-child {
              margin-top: 0;
            }
            h3 {
              font-size: 14px;
              font-weight: bold;
              margin-top: 18px;
              margin-bottom: 10px;
              margin-left: 15px;
            }
            h4 {
              font-size: 13px;
              font-weight: bold;
              margin-top: 15px;
              margin-bottom: 8px;
              margin-left: 30px;
            }
            table {
              width: 100%;
              border-collapse: collapse;
              margin-bottom: 20px;
              border: 1px solid #000;
            }
            th {
              background: #f0f0f0;
              padding: 8px;
              text-align: left;
              font-weight: bold;
              font-size: 11px;
              border: 1px solid #000;
            }
            td {
              padding: 6px 8px;
              border: 1px solid #ccc;
              font-size: 11px;
            }
            .total-row {
              background: #f5f5f5;
              border-top: 2px solid #000;
            }
            .total-row td {
              padding: 8px;
              font-weight: bold;
            }
            .no-data {
              padding: 20px;
              text-align: center;
              color: #999;
              font-style: italic;
              border: 1px dashed #ccc;
              margin: 15px 0;
            }
            @media print {
              body { 
                padding: 15px;
              }
              @page { 
                margin: 1.5cm;
              }
              table {
                page-break-inside: auto;
              }
              tr {
                page-break-inside: avoid;
                page-break-after: auto;
              }
              thead {
                display: table-header-group;
              }
              h2, h3, h4 {
                page-break-after: avoid;
              }
            }
          </style>
        </head>
        <body>
          <div class="header">
            <h1>${title}</h1>
            <div class="date">Generated: ${new Date().toLocaleDateString()}</div>
          </div>
          <div class="content-wrapper">
            ${renderContent()}
          </div>
        </body>
      </html>
    `

      console.log("[v0] HTML generated, setting preview state...")
      setReportPreview({ open: true, html: htmlContent, title: title })
      console.log("[v0] Report preview state set successfully")
    } catch (error) {
      console.error("[v0] Error in generatePDF:", error)
      alert(`Failed to generate PDF report: ${error instanceof Error ? error.message : "Unknown error"}`)
    }
  }

  const downloadCSV = (data: any[], title: string) => {
    const selectedFieldConfigs = reportFields[type].filter((f) => selectedFields.includes(f.key))
    const headers = selectedFieldConfigs.map((f) => f.label)

    // Ensure data is an array for CSV generation, even if grouped
    const flatData = Array.isArray(data) ? data : Object.values(data).flat(Number.POSITIVE_INFINITY)

    const rows = flatData.map((row) =>
      selectedFieldConfigs.map((field) => {
        const value = row[field.key]
        if (value === undefined || value === null) return ""
        // Basic handling for potential currency symbols and commas in numeric fields for CSV
        if (typeof value === "string" && (value.startsWith("$") || value.includes(","))) {
          const numericValue = value.replace(/[$,]/g, "")
          if (!isNaN(Number(numericValue))) {
            return numericValue
          }
        }
        if (typeof value === "object") return JSON.stringify(value)
        return `"${String(value).replace(/"/g, '""')}"`
      }),
    )

    const csvContent = [headers.join(","), ...rows.map((row) => row.join(","))].join("\n")

    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" })
    const link = document.createElement("a")
    const url = URL.createObjectURL(blob)
    link.setAttribute("href", url)
    link.setAttribute("download", `${title.replace(/\s+/g, "_")}_${new Date().toISOString().split("T")[0]}.csv`)
    link.style.visibility = "hidden"
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
  }

  const generateReport = async () => {
    // Ensure selectedFields has the correct structure (FieldConfig)
    const selectedFieldConfigs = reportFields[type].filter((f) => selectedFields.includes(f.key))

    if (selectedFieldConfigs.length === 0) {
      alert("Please select at least one field to include in the report")
      return
    }

    console.log("[v0] Starting report generation...")
    console.log("[v0] Report type:", type)
    console.log("[v0] Selected fields:", selectedFields)

    setGenerating(true)

    try {
      const data: any[] = []
      let title = ""
      let processedData: any = null
      let reportData: any[] = [] // Declare reportData here

      // Add lost-sales data fetching and processing
      if (type === "lost-sales") {
        try {
          // Determine which view to use based on selected preset
          let view = "detail" // Default to detail view
          if (selectedPreset === "By Month") {
            view = "summary" // Use summary view for "By Month" preset
          } else if (selectedPreset === "Top Requested Items") {
            view = "top-items" // Use top-items view for "Top Requested Items" preset
          } else if (selectedPreset === "By Product") {
            // Changed from "By Product, Customer & Quantity" to "By Product"
            view = "detail" // Use detail view for grouping
          }

          const params = new URLSearchParams()
          params.set("view", view) // Set the view parameter
          if (fromDate) params.set("startDate", fromDate)
          if (toDate) params.set("endDate", toDate)

          console.log("[v0] Fetching lost sales with params:", {
            view,
            startDate: fromDate,
            endDate: toDate,
            url: `/api/lost-sales?${params.toString()}`,
          })

          const response = await fetch(`/api/lost-sales?${params.toString()}`)
          if (!response.ok) throw new Error("Failed to fetch lost sales data")

          const rawData = await response.json()

          console.log("[v0] Lost sales data received:", {
            count: Array.isArray(rawData) ? rawData.length : "not an array",
            firstItem: Array.isArray(rawData) && rawData.length > 0 ? rawData[0] : null,
          })

          reportData = transformDatabaseData(rawData, "lost-sales")

          // Apply preset filter if any
          const preset = presetTemplates[type].find((p) => p.name === selectedPreset)
          if (preset?.filter) {
            reportData = preset.filter(reportData)
          }

          // Prepare grouping fields
          const currentGroupByFields = [groupBy, groupBy2, groupBy3].filter((f) => f !== "none")

          if (currentGroupByFields.length > 0) {
            processedData = groupData(reportData, currentGroupByFields)
          } else {
            processedData = reportData
          }

          title = selectedPreset || "Lost Sales Report"

          if (format === "pdf") {
            // Pass dateRange to generatePDF
            generatePDF(processedData, title, selectedFieldConfigs, currentGroupByFields, {
              startDate: fromDate,
              endDate: toDate,
            })
          } else {
            // For CSV, we always use flat data
            downloadCSV(reportData, title)
          }
        } catch (error) {
          console.error("[v0] Error generating lost sales report:", error)
          alert("Failed to generate lost sales report. Please try again.")
        } finally {
          setGenerating(false)
          // Reset form after generation
          setOpen(false)
          setSelectedFields([])
          setFromDate("")
          setToDate("")
          setSelectedPreset(null)
          setCategoryFilter("all")
          setGroupBy("none")
          setGroupBy2("none")
          setGroupBy3("none")
        }
        return // Exit after handling lost-sales
      }

      // Existing code for other report types
      switch (type) {
        case "sales": {
          console.log("[v0] Sales report - Total sales orders:", salesData.length)
          console.log("[v0] Sales report - Total customers:", customersData.length)
          console.log("[v0] Sales report - First customer:", customersData[0])

          reportData = salesData.map((order: any) => {
            const customer = customersData.find((c: any) => {
              const customerId = String(c.id || c.customer_id)
              const orderCustomerId = String(order.customerId)
              return customerId === orderCustomerId
            })

            if (!customer && order.customerId) {
              console.log("[v0] Customer not found for order:", {
                orderId: order.soId,
                customerId: order.customerId,
                availableCustomerIds: customersData.map((c: any) => c.id || c.customer_id).slice(0, 5),
              })
            }

            return {
              id: String(order.soId || order.id),
              soNumber: order.soNumber,
              customerId: String(order.customerId),
              orderDate: order.orderDate,
              deliveryDate: order.deliveryDate,
              status: order.status,
              installments: order.installments,
              total: order.total,
              notes: order.notes,
              invoiceFileUrl: order.invoiceFileUrl,
              createdAt: order.createdAt,
              items: `${order.items?.[0]?.productName || "Multiple items"} (${order.items?.length || 0})`,
              customerName: customer?.name || customer?.customer_name || `Customer #${order.customerId}`,
              customer_name: customer?.name || customer?.customer_name || `Customer #${order.customerId}`,
              customer_email: customer?.email || "",
              customer_phone: customer?.phone || "",
              paymentTerms: order.installments > 1 ? "Installments" : "Full Payment",
              totalRaw: Number(order.total || 0),
              statusRaw: order.status,
            }
          })

          console.log("[v0] First 3 mapped sales orders:", reportData.slice(0, 3))
          title = selectedPreset || "Sales Report"
          break
        }
        case "purchase":
          title = selectedPreset || "Purchase Orders Report"

          const isInventoryBasedReport = [
            "Reorder Needed (by Category)",
            "Critical Stock (Out of Stock)",
            "Low Stock by Category",
          ].includes(selectedPreset || "")

          if (isInventoryBasedReport) {
            reportData = inventory.map((item) => {
              const product = products.find((p) => p.product_id === item.product_id)
              const unitCost = item.unit_cost || item.unitCost || 0
              const quantity = item.quantity || 0
              const reorderPoint = item.reorder_point || item.reorderPoint || 0

              // Determine stock status
              let stockStatus = "in_stock"
              if (quantity === 0) {
                stockStatus = "out_of_stock"
              } else if (quantity <= reorderPoint) {
                stockStatus = "critical"
              } else if (quantity <= reorderPoint * 1.2) {
                stockStatus = "low"
              }

              return {
                productName: item.productName || product?.product_name || item.sku || "Unknown Product",
                sku: item.sku || product?.sku || "",
                category: item.category || product?.category || "Uncategorized",
                quantity: quantity,
                unitCost: unitCost,
                totalValue: quantity * unitCost,
                totalValueRaw: quantity * unitCost,
                reorderPoint: reorderPoint,
                location: item.location || "Main",
                stockStatus: stockStatus,
              }
            })
          } else {
            // Use purchase order data for PO reports
            reportData = purchaseOrders.map((order) => {
              const supplier = suppliers.find((s) => s.supplier_id === order.supplier_id)
              return {
                ...order,
                poNumber: order.po_number,
                supplierName: supplier?.supplier_name || "Unknown",
                supplier_name: supplier?.supplier_name || "Unknown",
                supplier_email: supplier?.email || "",
                supplier_phone: supplier?.phone || "",
                orderDate: order.order_date,
                total: order.total || 0,
                totalRaw: order.total || 0,
                statusRaw: order.status,
                paymentTerms: order.payment_terms,
                status: order.status,
                items: order.items?.map((i: any) => `${i.product_name} (${i.quantity})`).join(", ") || "",
                currency: order.currency || "USD",
              }
            })
          }
          break
        case "inventory":
          title = selectedPreset || "Inventory Report"
          reportData = inventory.map((item) => {
            const product = products.find((p) => p.product_id === item.product_id)
            const unitCost = item.unit_cost || item.unitCost || 0
            const quantity = item.quantity || 0
            const reorderPoint = item.reorder_point || item.reorderPoint || 0

            return {
              ...item,
              productName: item.productName || product?.product_name || item.sku || "Unknown Product",
              sku: item.sku || product?.sku || "",
              category: item.category || product?.category || "Uncategorized",
              quantity: quantity,
              unitCost: unitCost,
              totalValue: quantity * unitCost,
              totalValueRaw: quantity * unitCost,
              reorderPoint: reorderPoint,
              location: item.location || "Main",
            }
          })
          break
        case "financial":
          title = selectedPreset || "Financial Report"
          const filteredSalesForFinancial = filterByDateRange(salesData || [], "order_date")
          const filteredPurchasesForFinancial = filterByDateRange(purchaseOrders || [], "order_date")
          const totalSales = filteredSalesForFinancial.reduce((sum, so) => sum + (so.total || 0), 0)
          const totalPurchases = filteredPurchasesForFinancial.reduce((sum, po) => sum + (po.total || 0), 0)
          const arOutstanding = (accountsReceivable || [])
            .filter((ar) => (ar.amount || 0) > (ar.collected_amount || 0))
            .reduce((sum, ar) => sum + ((ar.amount || 0) - (ar.collected_amount || 0)), 0)
          const apOutstanding = (accountsPayable || [])
            .filter((ap) => (ap.amount || 0) > (ap.paid_amount || 0))
            .reduce((sum, ap) => sum + ((ap.amount || 0) - (ap.paid_amount || 0)), 0)

          reportData = [
            {
              balance: totalSales - totalPurchases,
              totalSales: totalSales,
              totalPurchases: totalPurchases,
              arOutstanding: arOutstanding,
              apOutstanding: apOutstanding,
              prepaidBalance: prepaidBalance || 0,
              customerPayments: (customerPayments || []).length,
              supplierPayments: (supplierPayments || []).length,
            },
          ]
          break
        case "customers":
          title = selectedPreset || "Customers Report"
          reportData = customersData.map((customer) => {
            const customerOrders = filterByDateRange(
              (salesData || []).filter((so) => so.customerId === customer.customerId),
              "orderDate", // Corrected field name
            )
            const customerAR = (accountsReceivable || []).filter((ar) => ar.customer_id === customer.customer_id)
            const overdueAmount = customerAR.reduce(
              (sum, ar) => sum + ((ar.amount || 0) - (ar.collected_amount || 0)),
              0,
            )

            return {
              name: customer.customer_name,
              email: customer.email,
              phone: `${customer.country_code || ""} ${customer.phone || ""}`.trim(),
              address: customer.address || "N/A",
              city: customer.city || "N/A",
              country: customer.country || "N/A",
              totalOrders: customerOrders.length,
              totalSpent: customerOrders.reduce((sum, so) => sum + (so.total || 0), 0),
              totalOverdue: overdueAmount,
            }
          })
          break
        case "suppliers":
          title = selectedPreset || "Suppliers Report"
          reportData = suppliers.map((supplier) => {
            const supplierOrders = filterByDateRange(
              (purchaseOrders || []).filter((po) => po.supplier_id === supplier.supplier_id),
              "orderDate", // Corrected field name
            )
            const supplierAP = (accountsPayable || []).filter((ap) => ap.supplier_id === supplier.supplier_id)
            const overdueAmount = supplierAP.reduce((sum, ap) => sum + ((ap.amount || 0) - (ap.paid_amount || 0)), 0)

            return {
              name: supplier.supplier_name,
              email: supplier.email,
              phone: `${supplier.country_code || ""} ${supplier.phone || ""}`.trim(),
              address: supplier.address || "N/A",
              city: supplier.city || "N/A",
              country: supplier.country || "N/A",
              totalOrders: supplierOrders.length,
              totalAmount: supplierOrders.reduce((sum, po) => sum + (po.total || 0), 0),
              totalOverdue: overdueAmount,
            }
          })
          break
      }

      // Apply date filter for sales/purchase
      if (type === "sales" || type === "purchase") {
        reportData = filterByDateRange(reportData, "orderDate")
      }

      // Apply preset filter
      if (selectedPreset) {
        const preset = presetTemplates[type].find((p) => p.name === selectedPreset)
        if (preset?.filter) {
          reportData = preset.filter(reportData)
        }
      }

      const currentGroupByFields = [groupBy, groupBy2, groupBy3].filter((f) => f !== "none")

      if (currentGroupByFields.length > 0) {
        processedData = groupData(reportData, currentGroupByFields)
      } else {
        processedData = reportData
      }

      if (format === "pdf") {
        // Pass dateRange to generatePDF
        generatePDF(processedData, title, selectedFieldConfigs, currentGroupByFields, {
          startDate: fromDate,
          endDate: toDate,
        })
      } else {
        // CSV always uses flat data
        downloadCSV(reportData, title)
      }

      setOpen(false)
      setSelectedFields([])
      setFromDate("")
      setToDate("")
      setSelectedPreset(null)
      setCategoryFilter("all")
      setGroupBy("none")
      setGroupBy2("none")
      setGroupBy3("none")
    } catch (error) {
      console.error("[v0] Report generation error:", error)
      alert("Error generating report. Please try again.")
    } finally {
      setGenerating(false)
    }
  }

  const getReportTitle = () => {
    const titles: Record<ReportType, string> = {
      sales: "Sales Report",
      inventory: "Inventory Report",
      purchase: "Purchase Orders Report",
      financial: "Financial Report",
      customers: "Customers Report",
      suppliers: "Suppliers Report",
      "lost-sales": "Lost Sales Report", // Added title for lost-sales
    }
    return titles[type]
  }

  const closeReportPreview = () => {
    setReportPreview({ open: false, html: "", title: "" })
    // Optionally, reset iframe source to prevent cached content issues
    if (iframeRef.current) {
      iframeRef.current.src = "about:blank"
    }
  }

  const handlePrint = () => {
    const iframe = iframeRef.current
    if (iframe && iframe.contentWindow) {
      try {
        iframe.contentWindow.focus()
        iframe.contentWindow.print()
      } catch (e) {
        console.log("[v0] iframe print failed, creating download")
        const blob = new Blob([reportPreview.html], { type: "text/html" })
        const url = URL.createObjectURL(blob)
        const a = document.createElement("a")
        a.href = url
        a.download = `${reportPreview.title.replace(/\s+/g, "_")}.html`
        document.body.appendChild(a)
        a.click()
        document.body.removeChild(a)
        URL.revokeObjectURL(url)

        alert(
          "PDF print failed. The report has been downloaded as an HTML file. You can open it and print from your browser.",
        )
      }
    } else {
      console.log("[v0] No iframe, creating download")
      const blob = new Blob([reportPreview.html], { type: "text/html" })
      const url = URL.createObjectURL(blob)
      const a = document.createElement("a")
      a.href = url
      a.download = `${reportPreview.title.replace(/\s+/g, "_")}.html`
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(url)

      alert("The report has been downloaded as an HTML file. You can open it and print from your browser.")
    }
  }

  const getPresetIcon = (presetName: string) => {
    if (presetName.toLowerCase().includes("reorder") || presetName.toLowerCase().includes("stock")) {
      return <Package className="h-4 w-4" />
    }
    if (presetName.toLowerCase().includes("critical") || presetName.toLowerCase().includes("out of stock")) {
      return <AlertTriangle className="h-4 w-4" />
    }
    if (presetName.toLowerCase().includes("low")) {
      return <TrendingDown className="h-4 w-4" />
    }
    return <FileText className="h-4 w-4" />
  }

  const handleDownload = () => {
    // For now, we'll create a downloadable HTML file based on the iframe content.
    // A true CSV download for the preview would require re-processing the data.
    if (reportPreview.html) {
      const blob = new Blob([reportPreview.html], { type: "text/html" })
      const url = URL.createObjectURL(blob)
      const a = document.createElement("a")
      a.href = url
      a.download = `${reportPreview.title.replace(/\s+/g, "_")}_preview.html`
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(url)
    } else {
      alert("No report content to download.")
    }
  }

  return (
    <>
      <Button onClick={() => setOpen(true)} variant="outline" size="sm" className="gap-2">
        <FileDown className="h-4 w-4 mr-2" />
        Generate Report
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-4xl w-[95vw] max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="text-xl font-bold">
              Generate {type.charAt(0).toUpperCase() + type.slice(1)} Report
            </DialogTitle>
          </DialogHeader>

          <div className="grid gap-6 py-4">
            {presetTemplates[type] && presetTemplates[type].length > 0 && (
              <div>
                <Label className="text-base font-semibold mb-3 block">Quick Templates</Label>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                  {presetTemplates[type].map((preset) => (
                    <button
                      key={preset.name}
                      onClick={() => applyPreset(preset.name)}
                      className={`text-left border-2 rounded-xl p-4 transition-all hover:border-primary hover:shadow-md ${
                        selectedPreset === preset.name
                          ? "border-primary bg-primary/5 shadow-md ring-2 ring-primary/20"
                          : "border-border bg-card"
                      }`}
                    >
                      <div className="flex items-center gap-2 mb-2">
                        <span
                          className={`p-1.5 rounded-lg ${
                            selectedPreset === preset.name
                              ? "bg-primary text-primary-foreground"
                              : "bg-muted text-muted-foreground"
                          }`}
                        >
                          {getPresetIcon(preset.name)}
                        </span>
                        <span className="font-semibold text-sm">{preset.name}</span>
                      </div>
                      <p className="text-xs text-muted-foreground leading-relaxed">{preset.description}</p>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {(type === "sales" ||
              type === "purchase" ||
              type === "financial" ||
              type === "customers" ||
              type === "suppliers" ||
              type === "lost-sales") && (
              <div className="bg-muted/30 rounded-xl p-4">
                <Label className="text-base font-semibold mb-3 block">Date Range (Optional)</Label>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <Label htmlFor="fromDate" className="text-sm mb-1.5 block text-muted-foreground">
                      From Date
                    </Label>
                    <Input
                      id="fromDate"
                      type="date"
                      value={fromDate}
                      onChange={(e) => setFromDate(e.target.value)}
                      max={toDate || undefined}
                      className="bg-background"
                    />
                  </div>
                  <div>
                    <Label htmlFor="toDate" className="text-sm mb-1.5 block text-muted-foreground">
                      To Date
                    </Label>
                    <Input
                      id="toDate"
                      type="date"
                      value={toDate}
                      onChange={(e) => setToDate(e.target.value)}
                      min={fromDate || undefined}
                      className="bg-background"
                    />
                  </div>
                </div>
                {(fromDate || toDate) && (
                  <p className="text-xs text-primary mt-3 font-medium">
                    {fromDate && toDate
                      ? `Filtering: ${new Date(fromDate).toLocaleDateString()} to ${new Date(toDate).toLocaleDateString()}`
                      : fromDate
                        ? `Filtering: From ${new Date(fromDate).toLocaleDateString()} onwards`
                        : `Filtering: Up to ${new Date(toDate).toLocaleDateString()}`}
                  </p>
                )}
              </div>
            )}

            <div className="bg-muted/30 rounded-xl p-4">
              <Label className="text-base font-semibold mb-3 block">Group By (Optional)</Label>
              <div className="grid grid-cols-3 gap-4">
                <div className="space-y-1.5">
                  <Label className="text-sm text-muted-foreground">Level 1</Label>
                  <Select
                    value={groupBy}
                    onValueChange={(val) => {
                      setGroupBy(val)
                      if (val === "none") {
                        setGroupBy2("none")
                        setGroupBy3("none")
                      }
                    }}
                  >
                    <SelectTrigger className="bg-background">
                      <SelectValue placeholder="Select field" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">None</SelectItem>
                      {reportFields[type].map((field) => (
                        <SelectItem key={field.key} value={field.key}>
                          {field.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label className="text-sm text-muted-foreground">Level 2</Label>
                  <Select
                    value={groupBy2}
                    onValueChange={(val) => {
                      setGroupBy2(val)
                      if (val === "none") setGroupBy3("none")
                    }}
                    disabled={groupBy === "none"}
                  >
                    <SelectTrigger className="bg-background">
                      <SelectValue placeholder="Select field" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">None</SelectItem>
                      {reportFields[type]
                        .filter((f) => f.key !== groupBy)
                        .map((field) => (
                          <SelectItem key={field.key} value={field.key}>
                            {field.label}
                          </SelectItem>
                        ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label className="text-sm text-muted-foreground">Level 3</Label>
                  <Select value={groupBy3} onValueChange={(val) => setGroupBy3(val)} disabled={groupBy2 === "none"}>
                    <SelectTrigger className="bg-background">
                      <SelectValue placeholder="Select field" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">None</SelectItem>
                      {reportFields[type]
                        .filter((f) => f.key !== groupBy && f.key !== groupBy2)
                        .map((field) => (
                          <SelectItem key={field.key} value={field.key}>
                            {field.label}
                          </SelectItem>
                        ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </div>

            <div>
              <Label className="text-base font-semibold mb-3 block">
                Select Fields to Include
                {selectedFields.length > 0 && (
                  <span className="ml-2 text-sm font-normal text-primary">({selectedFields.length} selected)</span>
                )}
              </Label>
              <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3 p-4 border rounded-xl bg-card">
                {reportFields[type].map((field) => (
                  <div key={field.key} className="flex items-center space-x-2">
                    <Checkbox
                      id={field.key}
                      checked={selectedFields.includes(field.key)}
                      onCheckedChange={(checked) => {
                        setSelectedFields(
                          checked ? [...selectedFields, field.key] : selectedFields.filter((f) => f !== field.key),
                        )
                      }}
                    />
                    <Label htmlFor={field.key} className="text-sm cursor-pointer">
                      {field.label}
                    </Label>
                  </div>
                ))}
              </div>
            </div>

            <div className="bg-muted/30 rounded-xl p-4">
              <Label className="text-base font-semibold mb-3 block">Output Format</Label>
              <div className="flex gap-3">
                <button
                  onClick={() => setFormat("pdf")}
                  className={`flex-1 py-3 px-4 rounded-lg border-2 transition-all font-medium ${
                    format === "pdf"
                      ? "border-primary bg-primary text-primary-foreground"
                      : "border-border bg-background hover:border-primary/50"
                  }`}
                >
                  PDF Report
                </button>
                <button
                  onClick={() => setFormat("csv")}
                  className={`flex-1 py-3 px-4 rounded-lg border-2 transition-all font-medium ${
                    format === "csv"
                      ? "border-primary bg-primary text-primary-foreground"
                      : "border-border bg-background hover:border-primary/50"
                  }`}
                >
                  CSV Export
                </button>
              </div>
            </div>

            <div className="flex gap-3 pt-2">
              <Button
                onClick={generateReport}
                disabled={generating || selectedFields.length === 0}
                className="flex-1 h-12 text-base"
                size="lg"
              >
                {generating ? (
                  <>
                    <Loader2 className="w-5 h-5 mr-2 animate-spin" />
                    Generating...
                  </>
                ) : (
                  <>
                    <FileDown className="w-5 h-5 mr-2" />
                    Generate {format.toUpperCase()}
                  </>
                )}
              </Button>
              <Button variant="outline" onClick={() => setOpen(false)} disabled={generating} size="lg" className="h-12">
                Cancel
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog
        open={reportPreview.open}
        onOpenChange={(open) => !open && setReportPreview({ ...reportPreview, open: false })}
      >
        <DialogContent className="max-w-[95vw] w-[95vw] h-[95vh] p-0 gap-0">
          <DialogHeader className="p-6 pb-4 border-b">
            <div className="flex items-center justify-between">
              <DialogTitle>{reportPreview.title}</DialogTitle>
              <div className="flex items-center gap-2">
                <Button onClick={handlePrint} variant="default" size="sm">
                  <Printer className="mr-2 h-4 w-4" />
                  Print
                </Button>
                <Button onClick={handleDownload} variant="outline" size="sm">
                  <Download className="mr-2 h-4 w-4" />
                  Download HTML
                </Button>
              </div>
            </div>
          </DialogHeader>
          <div className="flex-1 overflow-hidden p-6">
            <iframe
              ref={iframeRef}
              srcDoc={reportPreview.html}
              className="w-full h-full border rounded"
              title="Report Preview"
            />
          </div>
        </DialogContent>
      </Dialog>
    </>
  )
}
