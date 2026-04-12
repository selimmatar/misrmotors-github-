export type MaintenanceStatus = 
  | "pending"           // Created, waiting for worker assignment
  | "assigned"          // Worker assigned
  | "in_progress"       // Worker is working on it
  | "report_submitted"  // Worker submitted report
  | "pending_sales_review" // Sales needs to review
  | "sales_approved"    // Sales approved, ready for accounting
  | "pending_accounting" // Accounting needs to review/invoice
  | "invoiced"          // Invoice created
  | "completed"         // Fully completed
  | "cancelled"         // Cancelled

export interface MaintenanceWorkOrder {
  work_order_id: number
  work_order_number: string
  sales_order_id?: number
  customer_id: number
  title: string
  description: string
  category: string
  priority: "low" | "medium" | "high" | "urgent"
  status: MaintenanceStatus
  assigned_to?: number
  assigned_employee?: {
    employee_id: number
    full_name: string
    position?: string
  }
  scheduled_date?: string
  location?: string
  notes?: string
  created_at: string
  created_by?: string
  assigned_at?: string
  assigned_by?: string
}

export interface MaintenanceReport {
  report_id: number
  work_order_id: number
  employee_id: number
  findings: string
  is_settled: boolean
  equipment_needed?: string
  equipment_cost?: number
  labor_hours?: number
  labor_cost?: number
  total_cost?: number
  photo_urls?: string[]
  submitted_at: string
  approved_by?: string
  approved_at?: string
}

export interface MaintenanceInvoice {
  invoice_id: number
  work_order_id: number
  report_id: number
  customer_id: number
  invoice_number: string
  subtotal: number
  tax_amount?: number
  total_amount: number
  status: "draft" | "sent" | "paid" | "cancelled"
  due_date?: string
  notes?: string
  created_at: string
  created_by?: string
}
