export type UserRole = "ceo" | "accountant" | "sales-rep" | "warehouse-rep" | "po-rep" | "admin" | "shipment"

export interface User {
  id: string
  name: string
  email: string
  password: string
  role: UserRole
}

export interface Supplier {
  id: string
  name: string // Mapped from supplier_name
  email: string
  phone: string
  countryCode?: string // Added countryCode field for phone number formatting
  address: string
  city?: string
  country?: string
  paymentTerms?: string
  createdDate?: string
  leadTimeDays?: number // Average lead time in days for orders from this supplier
}

export interface Product {
  id: string
  productName: string
  sku: string
  description?: string
  unitPrice: number
  category: string
  unit?: string
  createdDate?: string
  desiredExcess?: number
  moq?: number
  lastLandedCost?: number
  markupPercentage?: number
  costUpdatedAt?: string
  costUpdatedBy?: number
}

export type PaymentType = "cash" | "installments" | "cheque" | "hybrid"
export type DownPaymentType = "cash" | "cheque"
export type SOType = "EQUIPMENT" | "MAINTENANCE_PARTS" | "MIXED"
export type ItemCategory = "EQUIPMENT" | "MAINTENANCE_PARTS"
export type DeliveryPermitStatus =
  | "DRAFT"
  | "PRINTED"
  | "OUT_FOR_DELIVERY"
  | "SUBMITTED_SIGNED"
  | "APPROVED"
  | "REJECTED"
  | "READY_FOR_PICKUP" // Added new status - Warehouse marks ready

export type FulfillmentStatus = "PENDING" | "OUT_FOR_DELIVERY" | "CONFIRMED"

export interface PaymentDetails {
  paymentType: PaymentType
  // Installment fields
  installmentMonths?: number
  monthlyAmount?: number
  // Cheque fields
  chequeNumber?: string
  chequeBankName?: string
  chequeDueDate?: string
  chequeAmount?: number
  chequeNotes?: string
  // Hybrid fields
  downPaymentType?: DownPaymentType
  downPaymentAmount?: number
  downPaymentPercent?: number
  remainingAmount?: number
  remainingInstallmentMonths?: number
  // Hybrid + Cheque down payment fields
  downPaymentChequeNumber?: string
  downPaymentChequeBank?: string
  downPaymentChequeDueDate?: string
}

export interface PurchaseOrder {
  id: string
  poNumber: string
  supplierId: string
  orderDate: string
  deliveryDate: string
  items: POItem[]
  status: "draft" | "pending" | "approved" | "rejected"
  total: number
  notes: string
  paymentTerms: "prepaid" | "installment"
  installments?: number
  currency?: "EGP" | "USD" | "EUR" // Added EUR to currency options
  poInvoiceUrl?: string // Added PO invoice URL field
  rejectionReason?: string // Added rejection reason field
  taxAmount?: number
  otherCosts?: number
  costFinalized?: boolean
  costFinalizedAt?: string
  costFinalizedBy?: number
  paymentType?: PaymentType
  paymentDetails?: PaymentDetails
  bankName?: string
  bankAccountNumber?: string
  bankSwiftCode?: string
  bankIban?: string
  bankBranch?: string
  bankHolderName?: string
}

export interface POItem {
  id?: string
  productId: string
  productName: string
  quantity: number
  unitPrice: number
  total: number
  allocatedTax?: number
  allocatedOverhead?: number
  landedCost?: number
}

export interface GoodsReceipt {
  id: string
  grNumber: string
  poId: string
  date: string
  items: GRItem[]
  status: "pending" | "completed"
  notes: string
}

export interface GRItem {
  id: string
  productName: string
  quantityReceived: number
  quantityOrdered: number
  unitPrice: number
}

export interface InventoryItem {
  id: string
  productId: string
  productName: string
  sku: string
  category: string
  quantity: number
  unit: string
  reorderPoint: number
  unitCost: number
  totalValue: number
  location: string
  warehouseId: number
  warehouseName?: string
  lastUpdated: string
}

export interface SupplierProduct {
  id: string
  supplierId: string
  productId: string
  supplierName?: string
  productName?: string
  supplierSku?: string
  unitCost?: number
  leadTimeDays?: number
  isPreferred: boolean
}

export interface AccountsPayableInvoice {
  // Renamed from SupplierInvoice
  id: string
  invoiceNumber: string
  supplierId: string
  supplierName?: string
  poId: string
  poNumber?: string
  amount: number
  totalAmount: number
  paidAmount: number
  date: string
  invoiceDate: string
  dueDate: string
  items: InvoiceItem[]
  balance: number
  installmentMonths: number
  monthsPaid: number
  status: "pending" | "partially_paid" | "paid" | "overdue" // Added "overdue" to match DB constraint
  invoiceFileUrl?: string // Added for uploaded invoice
  lastPaymentDate?: string
  paymentReceiptUrl?: string
  paymentTerms?: string
  paymentType?: string // cash, installments, cheque, hybrid, prepaid
  downPaymentAmount?: number
  remainingAmount?: number
  remainingInstallmentMonths?: number
  monthlyAmount?: number
  paymentStartDate?: string
  downPaymentDueDate?: string
}

export type SupplierInvoice = AccountsPayableInvoice

export interface InvoiceItem {
  id: string
  description: string
  quantity: number
  unitPrice: number
  total: number
}

export interface SupplierPayment {
  id: string
  invoiceId: string
  supplierId: string
  amount: number
  date: string
  paymentMethod: string
  referenceNumber: string
  status: "pending" | "completed"
}

export interface Customer {
  id: string
  name: string // Mapped from customer_name
  email: string
  phone: string
  countryCode?: string // Added countryCode field for phone number formatting
  address: string
  city?: string
  country?: string
  creditLimit?: number
  paymentTerms?: number
  status?: "active" | "inactive"
  createdDate?: string
}

export interface SalesOrder {
  id: string
  soNumber: string
  customerId: string
  orderDate: string
  deliveryDate: string
  deliveryAddress?: string
  deliveryContactName?: string
  deliveryContactPhone?: string
  items: SOItem[]
  status:
    | "draft"
    | "pending"
    | "pending_accountant" // After sales rep creates SO
    | "accountant_approved" // After accountant uploads invoice and approves
    | "ready_for_delivery" // After warehouse marks as ready to ship
    | "shipped" // After shipping team ships and uploads invoice
    | "delivered"
    | "cancelled"
  soType?: SOType // Add SO type field
  subtotal?: number // Sum of all line items before discount
  discountType?: "none" | "percentage" | "fixed"
  discountValue?: number // Percentage or fixed amount
  discountAmount?: number // Calculated discount amount
  total: number // Net total after discount
  notes: string
  paymentTerms: "prepaid" | "installment"
  installments?: number
  invoiceFileUrl?: string // Invoice uploaded by accountant
  shippingInvoiceUrl?: string // Shipping invoice uploaded by shipping team
  paymentType?: PaymentType
  paymentDetails?: PaymentDetails
}

export interface SOItem {
  id?: string
  productId: string
  productName: string
  quantity: number
  unitPrice: number
  total: number
  itemCategory?: ItemCategory // Add item category field
}

export interface AccountsReceivableInvoice {
  id: string
  invoiceNumber: string
  customerId: string
  customerName?: string
  soId: string
  soNumber?: string
  paymentTerms?: string | null
  isMaintenance?: boolean
  date: string
  dueDate: string
  items: InvoiceItem[]
  amount: number
  collectedAmount: number // Make sure this exists
  balance: number // Added balance field
  installmentMonths: number
  monthsPaid: number
  status: "pending" | "partially_paid" | "paid" | "overdue" // Added "overdue" to match DB constraint
  paymentReceipts?: Array<{ month: number; url: string }>
  pdfUrl?: string
  vatInvoiceUrl?: string
}

export type CustomerInvoice = AccountsReceivableInvoice

export interface CustomerPayment {
  id: string
  invoiceId: string
  customerId: string
  amount: number
  date: string
  paymentMethod: string
  referenceNumber: string
  status: "pending" | "completed"
}

export interface Installment {
  id: string
  invoiceId: string
  customerId: string
  amount: number
  dueDate: string
  status: "pending" | "paid"
  paymentDate?: string
}

export interface BalanceEntry {
  id: string
  type: "sales_order" | "purchase_order" | "ar_payment" | "ap_payment"
  referenceId: string // SO ID or PO ID or Invoice ID
  referenceNumber: string // SO Number or PO Number or Invoice Number
  amount: number // Positive for income, negative for expenses
  description: string
  createdAt: string
  createdBy: string
}

export interface WebhookConfig {
  id: string
  name: string
  url: string
  event: WebhookEvent
  enabled: boolean
  createdAt: string
  headers?: Record<string, string>
}

export type WebhookEvent =
  | "sales_order.created"
  | "sales_order.approved"
  | "purchase_order.created"
  | "purchase_order.approved"
  | "inventory.low_stock"
  | "payment.received"
  | "invoice.uploaded"
  | "customer.created"
  | "supplier.created"

export interface WebhookPayload {
  event: WebhookEvent
  timestamp: string
  data: any
}

export interface InventoryBatch {
  batchId: number
  productId: number
  poId?: number
  poNumber?: string
  quantityReceived: number
  quantityAvailable: number
  unitCost: number
  landedCostPerUnit?: number
  receivedDate: string
  batchSequence: number
  createdAt: string
}

export interface InventoryAllocation {
  allocationId: number
  salesOrderItemId: number
  soId: number
  batchId: number
  productId: number
  quantityAllocated: number
  costPerUnit: number
  totalCogs: number
  allocationMethod: "FIFO" | "LIFO"
  allocatedAt: string
}

export interface DeliveryPermit {
  id: string
  permitNo: string
  salesOrderId: string
  soNumber?: string
  soTotal?: number
  customerId?: string
  customerName?: string
  recipientName?: string
  recipientPhone?: string
  deliveryAddress?: string
  driverName?: string
  courierId?: string // Added courierId field for courier assignment
  status: DeliveryPermitStatus
  rejectionReason?: string
  printedAt?: string
  printedBy?: number
  outForDeliveryAt?: string
  outForDeliveryBy?: number
  submittedSignedAt?: string
  submittedSignedBy?: number
  approvedAt?: string
  approvedBy?: number
  rejectedAt?: string
  rejectedBy?: number
  createdBy?: number
  createdAt?: string
  updatedAt?: string
  items?: DeliveryPermitItem[]
  files?: DeliveryPermitFile[]
}

export interface DeliveryPermitItem {
  id?: string
  permitId: string
  productId?: string
  itemNameSnapshot: string
  skuSnapshot?: string
  unitSnapshot?: string
  quantity: number
  unitPrice?: number
  total?: number
}

export interface DeliveryPermitFile {
  id: string
  permitId: string
  fileType: "SIGNED_PERMIT" | "OTHER"
  fileUrl: string
  fileName?: string
  uploadedBy?: number
  uploadedAt?: string
  notes?: string
}

export interface WorkflowEvent {
  id: string
  entityType: string
  entityId: number
  eventType: string
  oldValue?: string
  newValue?: string
  performedBy?: number
  performedAt: string
  notes?: string
  metadata?: Record<string, any>
}
